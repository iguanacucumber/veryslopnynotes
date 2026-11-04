import type { ReactNode } from "react";
import {
  parseMarkdown,
  type InlineNode,
  type MarkdownBlock,
  type MarkdownLimits,
} from "../revisions/markdown";
import { reflowLegalMarkdown } from "./legal";

// Les notices sont des fichiers statiques et fiables du dépôt : le parseur
// borné peut dépasser le budget d'un corps de modèle, jamais interpréter du HTML.
const DOCUMENT_LIMITS: MarkdownLimits = {
  maxChars: 80_000,
  maxLines: 4_000,
  maxNodes: 12_000,
};

const HEADING_TAGS = ["h2", "h3", "h4", "h5", "h6", "h6"] as const;

function renderInline(nodes: InlineNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case "text":
        return node.text;
      case "strong":
        return <strong key={key}>{renderInline(node.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case "code":
        return (
          <code key={key} className="revision-markdown__code">
            {node.text}
          </code>
        );
      case "link":
        // Les liens du document restent du texte : la WebView ne quitte pas
        // l'application, et aucun fichier statique ne remplace la SPA.
        return (
          <span key={key} className="legal-document__link-text">
            {renderInline(node.children, key)}
          </span>
        );
      case "math":
        return <span key={key}>{node.tex}</span>;
    }
  });
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  const key = `block-${index}`;
  switch (block.type) {
    case "heading": {
      const Tag = HEADING_TAGS[block.level - 1] ?? "h6";
      return (
        <Tag key={key} className="revision-markdown__heading">
          {renderInline(block.children, key)}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p key={key} className="revision-markdown__paragraph">
          {renderInline(block.children, key)}
        </p>
      );
    case "list":
      if (block.ordered) {
        return (
          <ol key={key} className="revision-markdown__list" start={block.start}>
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
            ))}
          </ol>
        );
      }
      return (
        <ul key={key} className="revision-markdown__list">
          {block.items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
          ))}
        </ul>
      );
    case "quote": {
      let node: ReactNode = (
        <p key={`${key}-p`} className="revision-markdown__paragraph">
          {renderInline(block.children, key)}
        </p>
      );
      for (let depth = block.depth; depth >= 1; depth--) {
        node = (
          <blockquote
            key={depth === block.depth ? key : `${key}-q${depth}`}
            className="revision-markdown__quote"
          >
            {node}
          </blockquote>
        );
      }
      return node;
    }
    case "table":
      return (
        <div
          key={key}
          className="revision-markdown__table-wrap"
          role="region"
          aria-label="Tableau du document"
          tabIndex={0}
        >
          <table className="revision-markdown__table">
            <thead>
              <tr>
                {block.header.map((cell, cellIndex) => (
                  <th key={`${key}-h${cellIndex}`} scope="col">
                    {renderInline(cell, `${key}-h${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${key}-r${rowIndex}`}>
                  {block.header.map((_, cellIndex) => (
                    <td key={`${key}-r${rowIndex}-c${cellIndex}`}>
                      {renderInline(row[cellIndex] ?? [], `${key}-r${rowIndex}-c${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "math":
      return <p key={key}>{block.tex}</p>;
  }
}

/** Document statique complet, hors ligne et sans HTML brut. */
export function LegalDocument({ markdown }: { markdown: string }) {
  const blocks = parseMarkdown(reflowLegalMarkdown(markdown), DOCUMENT_LIMITS);
  return (
    <div className="revision-markdown legal-document">{blocks.map(renderBlock)}</div>
  );
}
