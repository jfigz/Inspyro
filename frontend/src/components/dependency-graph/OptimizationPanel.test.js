import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import OptimizationPanel from './OptimizationPanel';

describe('OptimizationPanel', () => {
  it('muestra un error local trazable cuando optimizar no tiene variables numericas', () => {
    const sendMessage = jest.fn();

    render(
      <OptimizationPanel
        inputNodes={[]}
        outputNodes={[{ data: { label: 'capacity_ratio' } }]}
        allNodes={[]}
        onClose={jest.fn()}
        sendMessage={sendMessage}
        lastMessage={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));

    expect(screen.getByText(/\[!\] No hay variables numericas de diseno/)).toBeTruthy();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
