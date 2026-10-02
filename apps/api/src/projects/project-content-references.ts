import {
  ProjectRichTextDocumentSchema,
  FileVersionReferenceSchema,
  type ProjectRichTextNode,
} from '@workspace/contracts';
import type { FileReferenceInput } from '@workspace/database/repositories/files';

export function projectContentReferences(input: unknown) {
  const document = ProjectRichTextDocumentSchema.parse(input);
  const references: (FileReferenceInput & { image: boolean })[] = [];
  const visit = (nodes: ProjectRichTextNode[], parent: string) => {
    for (const [index, node] of nodes.entries()) {
      const path = parent ? `${parent}.${index}` : String(index);
      if (node.type === 'fileImage' || node.type === 'fileAttachment') {
        const reference = FileVersionReferenceSchema.parse({
          fileId: node.attrs!.fileId,
          versionId: node.attrs!.versionId,
        });
        references.push({
          ...reference,
          referenceKey: path,
          position: references.length,
          image: node.type === 'fileImage',
        });
      }
      if (node.content) visit(node.content, path);
    }
  };
  // 索引从正式文档派生；客户端不能用另一份引用列表隐藏节点或伪造删除阻塞。
  visit(document.content, '');
  return { document, references };
}
