 
import React from "react";
import {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  $getRoot,
} from "lexical";
import { BasePillNode, getEditorDocument, SerializedBasePillNode } from "./BasePillNode";
import { TruncatedPillText } from "./TruncatedPillText";
import { PillBadge } from "./PillBadge";
import { Calendar } from "lucide-react";

export type SerializedCalendarPillNode = SerializedBasePillNode;

export class CalendarPillNode extends BasePillNode {
  static getType(): string {
    return "calendar-pill";
  }

  static clone(node: CalendarPillNode): CalendarPillNode {
    return new CalendarPillNode(node.__key);
  }

  constructor(key?: NodeKey) {
    super("Google Calendar", key);
  }

  getClassName(): string {
    return "calendar-pill-wrapper";
  }

  getDataAttribute(): string {
    return "data-lexical-calendar-pill";
  }

  createDOM(_config: EditorConfig, editor: LexicalEditor): HTMLElement {
    const span = getEditorDocument(editor).createElement("span");
    span.className = "calendar-pill-wrapper";
    return span;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (node: HTMLElement) => {
        if (node.hasAttribute("data-lexical-calendar-pill")) {
          return {
            conversion: convertCalendarPillElement,
            priority: 2,
          };
        }
        return null;
      },
    };
  }

  static importJSON(_serializedNode: SerializedCalendarPillNode): CalendarPillNode {
    return $createCalendarPillNode();
  }

  exportJSON(): SerializedCalendarPillNode {
    return {
      ...super.exportJSON(),
      type: "calendar-pill",
      version: 1,
    };
  }

  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const element = getEditorDocument(editor).createElement("span");
    element.setAttribute("data-lexical-calendar-pill", "true");
    element.textContent = "{calendar}";
    return { element };
  }

  getTextContent(): string {
    return "{calendar}";
  }

  decorate(): JSX.Element {
    return <CalendarPillComponent />;
  }
}

function convertCalendarPillElement(_domNode: HTMLElement): DOMConversionOutput | null {
  const node = $createCalendarPillNode();
  return { node };
}

function CalendarPillComponent(): JSX.Element {
  return (
    <PillBadge>
      <div className="tw-flex tw-items-center tw-gap-1">
        <Calendar className="tw-size-3 tw-text-accent" />
        <TruncatedPillText
          content="Google Calendar"
          openBracket="{"
          closeBracket="}"
          tooltipContent={
            <div className="tw-text-left">
              Will fetch today's Google Calendar events and inject them into the AI's context.
            </div>
          }
        />
      </div>
    </PillBadge>
  );
}

// Utility functions
export function $createCalendarPillNode(): CalendarPillNode {
  return new CalendarPillNode();
}

export function $isCalendarPillNode(
  node: LexicalNode | null | undefined
): node is CalendarPillNode {
  return node instanceof CalendarPillNode;
}

/**
 * Removes all calendar pills from the editor
 * @returns The number of pills removed
 */
export function $removeCalendarPills(): number {
  const root = $getRoot();
  let removedCount = 0;

  function traverse(node: LexicalNode): void {
    if ($isCalendarPillNode(node)) {
      node.remove();
      removedCount++;
    } else if ("getChildren" in node && typeof node.getChildren === "function") {
      const children = node.getChildren() as LexicalNode[];
      for (const child of children) {
        traverse(child);
      }
    }
  }

  traverse(root);
  return removedCount;
}

/**
 * Checks if the editor has any calendar pills
 */
export function $hasCalendarPills(): boolean {
  const root = $getRoot();
  let hasPills = false;

  function traverse(node: LexicalNode): void {
    if (hasPills) return;

    if ($isCalendarPillNode(node)) {
      hasPills = true;
      return;
    } else if ("getChildren" in node && typeof node.getChildren === "function") {
      const children = node.getChildren() as LexicalNode[];
      for (const child of children) {
        traverse(child);
      }
    }
  }

  traverse(root);
  return hasPills;
}
