import type { ReactNode } from "react";
import { parseMarkdown, type InlineNode, type MarkdownBlock } from "./markdown";

// Rendu React du markdown des fiches (#630). Le parseur produit un AST borné ;
// ce fichier ne crée que des éléments React. Aucun rendu HTML brut, aucune URL,
// aucun attribut du modèle : une balise HTML reste du texte, que React échappe.

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
        // Liens désactivés : libellé seul, jamais de href. Le pont pourra
        // ouvrir un lien plus tard ; d'ici là aucun schéma (javascript:,
        // data:) n'atteint le DOM.
        return (
          <span key={key} className="revision-markdown__link">
            {renderInline(node.children, key)}
          </span>
        );
    }
  });
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  const key = `block-${index}`;
  switch (block.type) {
    case "heading": {
      const Tag = block.level <= 2 ? "h4" : "h5";
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
          <blockquote key={depth === block.depth ? key : `${key}-q${depth}`} className="revision-markdown__quote">
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
          aria-label="Tableau de la fiche"
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
  }
}

/** Corps d'une fiche ouverte : markdown borné, rendu en éléments React. */
export function MarkdownBody({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return <div className="revision-markdown">{blocks.map(renderBlock)}</div>;
}
