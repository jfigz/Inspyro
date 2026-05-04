import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import QuantityVariablesPanel from './QuantityVariablesPanel';

const isUnitsUrl = (url, pathname) => String(url) === pathname || String(url).endsWith(pathname);

function buildFetchMock() {
  return jest.fn(async (url) => {
    if (isUnitsUrl(url, '/api/units/catalog')) {
      return {
        ok: true,
        json: async () => ({
          count: 3,
          units: [
            {
              canonical: 'kN',
              display: 'kN',
              category: 'Fuerza',
              dimension: '[mass] * [length] / [time] ** 2',
              aliases: ['kN'],
            },
            {
              canonical: 'N',
              display: 'N',
              category: 'Fuerza',
              dimension: '[mass] * [length] / [time] ** 2',
              aliases: ['N'],
            },
            {
              canonical: 'tf',
              display: 'tf',
              category: 'Fuerza',
              dimension: '[mass] * [length] / [time] ** 2',
              aliases: ['tf', 'tonf'],
            },
          ],
        }),
      };
    }

    if (isUnitsUrl(url, '/api/units/compatible')) {
      return {
        ok: true,
        json: async () => ({
          dimension: '[mass] * [length] / [time] ** 2',
          compatible_units: ['N', 'tf'],
        }),
      };
    }

    if (isUnitsUrl(url, '/api/units/convert')) {
      return {
        ok: true,
        json: async () => ({
          magnitude: 1.5,
          from_unit: 'kN',
          to_unit: 'N',
          converted_magnitude: 1500,
          repr: '1500 N',
          category: 'Fuerza',
          metadata: { symbol: 'N', category: 'Fuerza' },
          canonical: { from_unit: 'kN', to_unit: 'N', input_from: 'kN', input_to: 'N' },
        }),
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  });
}

describe('QuantityVariablesPanel', () => {
  beforeEach(() => {
    global.fetch = buildFetchMock();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('renders quantity variables and performs conversion', async () => {
    render(
      <QuantityVariablesPanel
        variables={{
          F: { type: 'Quantity', is_quantity: true, magnitude: 1.5, unit: 'kN', category: 'Fuerza' },
          x: { type: 'float', value: 10 },
        }}
      />
    );

    expect(screen.getByText('F')).toBeTruthy();
    expect(screen.queryByText('x')).toBeNull();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/units\/compatible$/),
        expect.objectContaining({ method: 'POST' })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Convertir' }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/units\/convert$/),
        expect.objectContaining({ method: 'POST' })
      )
    );

    const convertCall = global.fetch.mock.calls.find((call) => isUnitsUrl(call[0], '/api/units/convert'));
    expect(convertCall).toBeTruthy();
    expect(convertCall[1].body).toContain('"from_unit":"kN"');
    expect(convertCall[1].body).toContain('"to_unit":"N"');

    await waitFor(() => expect(screen.getByText('1500 N')).toBeTruthy());
  });

  it('shows conversion error per row', async () => {
    global.fetch = jest.fn(async (url) => {
      if (isUnitsUrl(url, '/api/units/catalog')) {
        return { ok: true, json: async () => ({ count: 0, units: [] }) };
      }
      if (isUnitsUrl(url, '/api/units/compatible')) {
        return { ok: true, json: async () => ({ compatible_units: ['kPa'] }) };
      }
      if (isUnitsUrl(url, '/api/units/convert')) {
        return { ok: false, json: async () => ({ message: 'Unidades incompatibles' }) };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(
      <QuantityVariablesPanel
        variables={{
          sigma: { type: 'Quantity', is_quantity: true, magnitude: 25, unit: 'MPa', category: 'Presión / Esfuerzo' },
        }}
      />
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/units\/compatible$/), expect.any(Object)));
    fireEvent.click(screen.getByRole('button', { name: 'Convertir' }));

    await waitFor(() => expect(screen.getByText('Unidades incompatibles')).toBeTruthy());
  });
});
