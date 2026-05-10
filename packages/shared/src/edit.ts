import type { ElementId } from './ids.js';

export type Edit = ClassNameEdit | StyleEdit | CssModuleEdit | StyledPropEdit;

export interface ClassNameEdit {
  kind: 'className';
  element: ElementId;
  newValue: string;
}

export interface StyleEdit {
  kind: 'style';
  element: ElementId;
  newObjectText: string;
}

export interface CssModuleEdit {
  kind: 'css-module';
  element: ElementId;
  binding: string;            // CSS class name within the module file (e.g. 'title')
  newRuleBody: string;        // body content between { ... } of the rule (without braces)
}

export interface StyledPropEdit {
  kind: 'styled-prop';
  element: ElementId;
  newTemplateContent: string; // new content of the styled.X`...` template literal
}
