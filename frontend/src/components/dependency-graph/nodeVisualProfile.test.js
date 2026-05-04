import { formatNodeLocationLabel, getNodeVisualProfile } from './nodeVisualProfile';
import { getNodeDimensions } from './nodeSizing';

describe('nodeVisualProfile', () => {
    it('clasifica imports externos con procedencia visible', () => {
        const profile = getNodeVisualProfile({
            id: 'helpers.B',
            name: 'B',
            node_type: 'import',
            is_external: true,
            full_name: 'helpers.B',
            location: { file: 'C:\\workspace\\helpers.py', line: 7 },
        });

        expect(profile.profileKey).toBe('import-external');
        expect(profile.fileLabel).toBe('helpers.py');
        expect(profile.description).toBe('helpers.B');
    });

    it('clasifica checks y conserva su estado resumido', () => {
        const profile = getNodeVisualProfile({
            id: 'check',
            name: 'sigma_check',
            node_type: 'check',
            is_check: true,
            check_result: false,
            check_message: 'No cumple',
        });

        expect(profile.profileKey).toBe('check-constraint');
        expect(profile.checkTone).toBe('fail');
        expect(profile.checkLabel).toBe('FAIL');
    });

    it('reduce el detalle visible en large graph mode sin cambiar el perfil', () => {
        const node = {
            id: 'result',
            name: 'M_max',
            node_type: 'variable',
            category: 'result',
            unit: 'kN m',
            runtime_value: { type: 'float', value: '123.45' },
            value_preview: 'w * L**2 / 8',
            description: 'Momento maximo',
            valid_range: [0, 200],
        };

        const full = getNodeVisualProfile(node, { isOutput: true, largeGraphMode: false });
        const compact = getNodeVisualProfile(node, { isOutput: true, largeGraphMode: true });
        const fullDims = getNodeDimensions(node, { isOutput: true, largeGraphMode: false });
        const compactDims = getNodeDimensions(node, { isOutput: true, largeGraphMode: true });

        expect(full.profileKey).toBe('computed-result');
        expect(compact.profileKey).toBe('computed-result');
        expect(compact.lines.length).toBeLessThanOrEqual(full.lines.length);
        expect(compactDims.height).toBeLessThanOrEqual(fullDims.height);
    });

    it('evita usar ids crudos de celda como etiqueta primaria de ubicacion', () => {
        expect(formatNodeLocationLabel({ cell_id: '2032f796-raw-cell-id', line: 6 }))
            .toBe('Celda del notebook - L6');
        expect(formatNodeLocationLabel({ cell_index: 3, cell_id: '2032f796-raw-cell-id', line: 6 }))
            .toBe('Celda 4 - L6');
    });
});
