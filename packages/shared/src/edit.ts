import type { ElementId } from './ids.js';

export type Edit = ClassNameEdit | StyleEdit;

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
