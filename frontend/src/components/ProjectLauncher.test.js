import { fireEvent, render, screen } from '@testing-library/react';
import ProjectLauncher from './ProjectLauncher';

describe('ProjectLauncher', () => {
  it('renders the three launch paths and recent workspaces', () => {
    render(
      <ProjectLauncher
        suggestedWorkspaceRoot="C:\\Projects"
        recentWorkspaces={['C:\\Projects\\demo-one']}
        onCreateProject={jest.fn()}
        onStartWithAgent={jest.fn()}
        onStartFromExample={jest.fn()}
        onOpenWorkspace={jest.fn()}
        onOpenRecentWorkspace={jest.fn()}
      />,
    );

    expect(screen.getByText('Espacio de ingeniería nativo para IA')).toBeTruthy();
    expect(screen.getByTestId('launcher-start-agent')).toBeTruthy();
    expect(screen.getByTestId('launcher-start-example')).toBeTruthy();
    expect(screen.getByTestId('launcher-open-project')).toBeTruthy();
    expect(screen.getByText('Workspaces recientes')).toBeTruthy();
  });

  it('wires the launch buttons to the expected callbacks', () => {
    const onCreateProject = jest.fn();
    const onStartWithAgent = jest.fn();
    const onStartFromExample = jest.fn();
    const onOpenWorkspace = jest.fn();

    render(
      <ProjectLauncher
        suggestedWorkspaceRoot="C:\\Projects"
        recentWorkspaces={[]}
        onCreateProject={onCreateProject}
        onStartWithAgent={onStartWithAgent}
        onStartFromExample={onStartFromExample}
        onOpenWorkspace={onOpenWorkspace}
        onOpenRecentWorkspace={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('launcher-start-agent'));
    fireEvent.click(screen.getByTestId('launcher-start-example'));
    fireEvent.click(screen.getByTestId('launcher-open-project'));
    fireEvent.click(screen.getByTestId('launcher-create-project'));

    expect(onStartWithAgent).toHaveBeenCalledTimes(1);
    expect(onStartFromExample).toHaveBeenCalledTimes(1);
    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
    expect(onCreateProject).toHaveBeenCalledTimes(1);
  });
});
