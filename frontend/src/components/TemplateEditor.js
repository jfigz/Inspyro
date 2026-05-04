import React from 'react';
import { createPortal } from 'react-dom';
import TemplateEditorContainer from './template-editor/TemplateEditorContainer';

const TemplateEditor = (props) => {
    if (typeof document === 'undefined' || !document.body) {
        return <TemplateEditorContainer {...props} />;
    }

    return createPortal(
        <TemplateEditorContainer {...props} />,
        document.body
    );
};

export default TemplateEditor;
