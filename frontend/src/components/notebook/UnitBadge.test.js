import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import UnitBadge from './UnitBadge';

const isUnitsUrl = (url, pathname) => String(url) === pathname || String(url).endsWith(pathname);

describe('UnitBadge', () => {
  it('renders magnitude and unit', () => {
    render(<UnitBadge magnitude={14.5} unit="kN" metadata={null} />);
    expect(screen.getByText('14.5')).toBeTruthy();
    expect(screen.getByText('kN')).toBeTruthy();
  });

  it('shows tooltip on hover when metadata exists', () => {
    render(
      <UnitBadge
        magnitude={25}
        unit="MPa"
        metadata={{
          category: 'Presión / Esfuerzo',
          symbol: 'MPa',
          description: 'Megapascal',
          dimension: '[pressure]',
        }}
      />
    );

    const root = screen.getByText('MPa').closest('.unit-badge');
    expect(root).toBeTruthy();
    fireEvent.mouseEnter(root);

    expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(screen.getByText('Presión / Esfuerzo')).toBeTruthy();
    expect(screen.getByText('Megapascal')).toBeTruthy();

    fireEvent.mouseLeave(root);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('formats physical dimension lines for force and stress units', async () => {
    render(
      <div>
        <UnitBadge magnitude={87} unit="kN" metadata={null} />
        <UnitBadge magnitude={35} unit="MPa" metadata={null} />
      </div>
    );

    const kNRoot = screen.getByText('kN').closest('.unit-badge');
    fireEvent.mouseEnter(kNRoot);
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy());
    expect(screen.getByText('Dimensión: M · L · T⁻²')).toBeTruthy();
    expect(screen.getByText('Fundamentales: Masa · Longitud · Tiempo⁻²')).toBeTruthy();
    fireEvent.mouseLeave(kNRoot);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());

    const mPaRoot = screen.getByText('MPa').closest('.unit-badge');
    fireEvent.mouseEnter(mPaRoot);
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy());
    expect(screen.getByText('Dimensión: M · L⁻¹ · T⁻²')).toBeTruthy();
    expect(screen.getByText('Fundamentales: Masa · Longitud⁻¹ · Tiempo⁻²')).toBeTruthy();
  });

  it('hydrates compound unit metadata from backend compatibility endpoint', async () => {
    const originalFetch = global.fetch;
    try {
      global.fetch = jest.fn(async (url) => {
        if (isUnitsUrl(url, '/api/units/catalog')) {
          return { ok: true, json: async () => ({ count: 0, units: [] }) };
        }
        if (isUnitsUrl(url, '/api/units/compatible')) {
          return {
            ok: true,
            json: async () => ({
              dimension: '[mass] / [length] ** 3',
              canonical: {
                canonical: 'kg/m³',
                display: 'kg/m³',
                category: 'Unidad compuesta',
                description: 'Densidad de masa',
                aliases: ['kg/m³', 'kg/m**3'],
              },
              compatible_units: [],
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      render(<UnitBadge magnitude={7850} unit="kg/m³" metadata={null} />);

        await waitFor(() => {
          expect(global.fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/api\/units\/compatible$/),
            expect.objectContaining({ method: 'POST' })
          );
        });

      const root = screen.getByText('kg/m³').closest('.unit-badge');
      fireEvent.mouseEnter(root);

      await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy());
      expect(screen.getByText('Dimensión: M · L⁻³')).toBeTruthy();
      expect(screen.getByText('Fundamentales: Masa · Longitud⁻³')).toBeTruthy();

      fireEvent.mouseLeave(root);
      expect(screen.queryByRole('tooltip')).toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('resolves backend metadata even when initial metadata is partial', async () => {
    const originalFetch = global.fetch;
    try {
      global.fetch = jest.fn(async (url) => {
        if (isUnitsUrl(url, '/api/units/catalog')) {
          return { ok: true, json: async () => ({ count: 0, units: [] }) };
        }
        if (isUnitsUrl(url, '/api/units/compatible')) {
          return {
            ok: true,
            json: async () => ({
              dimension: '[mass] / [length]',
              canonical: {
                canonical: 'kg/m',
                display: 'kg/m',
                category: 'Unidad compuesta',
                description: 'Densidad lineal',
                aliases: ['kg/m'],
              },
              compatible_units: [],
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      render(
        <UnitBadge
          magnitude={12}
          unit="kg/m"
          metadata={{
            symbol: 'kg/m',
            category: 'Unidad compuesta',
            description: 'Unidad compuesta: kg/m',
            dimension: '',
          }}
        />
      );

        await waitFor(() => {
          expect(global.fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/api\/units\/compatible$/),
            expect.objectContaining({ method: 'POST' })
          );
        });

      const root = screen.getByText('kg/m').closest('.unit-badge');
      fireEvent.mouseEnter(root);
      await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy());
      expect(screen.getByText('Dimensión: M · L⁻¹')).toBeTruthy();
      expect(screen.getByText('Fundamentales: Masa · Longitud⁻¹')).toBeTruthy();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('infers compound fundamentals when backend metadata lookup fails', async () => {
    const originalFetch = global.fetch;
    try {
      global.fetch = jest.fn(async () => {
        throw new Error('network down');
      });

      render(
        <UnitBadge
          magnitude={12}
          unit="kg/m"
          metadata={{
            symbol: 'kg/m',
            category: 'Unidad compuesta',
            description: 'Unidad compuesta: kg/m',
            dimension: '',
          }}
        />
      );

      const root = screen.getByText('kg/m').closest('.unit-badge');
      fireEvent.mouseEnter(root);
      await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy());
      expect(screen.getByText('Dimensión: M · L⁻¹')).toBeTruthy();
      expect(screen.getByText('Fundamentales: Masa · Longitud⁻¹')).toBeTruthy();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
