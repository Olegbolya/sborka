'use client';
import { type Block, QUESTION_TYPES, RichText, SafeHref, TEXT_PLACEHOLDERS, walkBlocks } from '@blokum/schema';
import { Node, mergeAttributes } from '@tiptap/core';
import { EditorContent, useEditor as useTipTap } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { patchBlocks } from '../../lib/editor/commands';
import { type EditorNode, fromEditorDoc, toEditorDoc } from '../../lib/editor/rich-text';
import { useEditor } from './context';

/** A variable, a system value or an answer inside the text: one indivisible piece shown as «{{имя}}» (L-04, L-05). */
const Placeholder = (label: (kind: string, ref: string) => string) =>
  Node.create({
    name: 'placeholder',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    addAttributes: () => ({ kind: { default: 'v' }, ref: { default: '' } }),
    parseHTML: () => [{ tag: 'span[data-placeholder]' }],
    renderHTML: ({ node, HTMLAttributes }) => [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-placeholder': String(node.attrs.kind), class: 'ed-placeholder' }),
      `{{${label(String(node.attrs.kind), String(node.attrs.ref))}}}`,
    ],
  });

const textOf = (rt: RichText | undefined): string => JSON.stringify(rt ?? { paragraphs: [] });

/** B-01 · the text of a block: bold, italic, underline, strikethrough, a link, lists, variables. The document holds it as `textLayer`. */
export function TextEditor({ block }: { block: Block }) {
  const apply = useEditor((s) => s.apply);
  const variables = useEditor((s) => s.doc.variables);
  const doc = useEditor((s) => s.doc);
  const [tick, setTick] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('https://');
  const [problem, setProblem] = useState<string | null>(null);

  const questions = useMemo(() => [...doc.screens.flatMap((s) => [...walkBlocks(s.blocks)])].filter((b) => QUESTION_TYPES.includes(b.type)), [doc]);
  // The labels are read when drawn, so a renamed variable shows its new name without a new editor.
  const names = useRef({ variables, questions });
  names.current = { variables, questions };
  const label = useRef((kind: string, ref: string): string => {
    if (kind === 'v') return names.current.variables.find((v) => v.id === ref)?.name ?? 'переменная';
    if (kind === 'answer') return `ответ: ${names.current.questions.find((q) => q.id === ref)?.name ?? 'вопрос'}`;
    return ref;
  });

  const last = useRef(textOf(block.textLayer));
  const editor = useTipTap({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        hardBreak: false,
        trailingNode: false,
        link: { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: (url) => SafeHref.safeParse(url).success },
      }),
      Placeholder((k, r) => label.current(k, r)),
    ],
    content: toEditorDoc(block.textLayer),
    editorProps: { attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Текст блока', class: 'ed-richtext' } },
    onTransaction: () => setTick((n) => n + 1),
    onUpdate: ({ editor: e }) => {
      const next = RichText.safeParse(fromEditorDoc(e.getJSON() as EditorNode));
      if (!next.success) {
        setProblem('Текст слишком длинный: не больше 5000 знаков.');
        e.commands.undo();
        return;
      }
      setProblem(null);
      last.current = textOf(next.data);
      apply(patchBlocks([block.id], (b) => void (b.textLayer = next.data)), { label: 'Текст блока', mergeKey: `text:${block.id}` });
    },
  });

  // Undo, redo or a restored version changed the text from outside: the editor follows.
  useEffect(() => {
    if (!editor || textOf(block.textLayer) === last.current) return;
    last.current = textOf(block.textLayer);
    editor.commands.setContent(toEditorDoc(block.textLayer), { emitUpdate: false });
  }, [editor, block.textLayer]);

  if (!editor) return null;
  void tick;
  const toggle = (name: string, title: string, run: () => void) => (
    <button key={name} type="button" className="ed-btn small" aria-pressed={editor.isActive(name)} aria-label={title} title={title} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {title}
    </button>
  );
  const insert = (value: string) => {
    const [kind, ref] = value.split(':') as [string, string];
    editor.chain().focus().insertContent({ type: 'placeholder', attrs: { kind, ref } }).run();
  };
  const applyLink = () => {
    if (!SafeHref.safeParse(href).success) return setProblem('Ссылка должна начинаться с https://, http://, mailto: или tel:');
    setProblem(null);
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setLinkOpen(false);
  };

  return (
    <div className="ed-field" data-control="text-layer">
      <span>Текст</span>
      <div className="ed-actions" role="toolbar" aria-label="Форматирование текста">
        {toggle('bold', 'Жирный', () => editor.chain().focus().toggleBold().run())}
        {toggle('italic', 'Курсив', () => editor.chain().focus().toggleItalic().run())}
        {toggle('underline', 'Подчёркнутый', () => editor.chain().focus().toggleUnderline().run())}
        {toggle('strike', 'Зачёркнутый', () => editor.chain().focus().toggleStrike().run())}
        {toggle('bulletList', 'Список', () => editor.chain().focus().toggleBulletList().run())}
        {toggle('orderedList', 'Нумерованный список', () => editor.chain().focus().toggleOrderedList().run())}
        {toggle('link', 'Ссылка', () => (editor.isActive('link') ? editor.chain().focus().extendMarkRange('link').unsetLink().run() : setLinkOpen(true)))}
      </div>
      {linkOpen && (
        <div className="ed-colorrow">
          <input type="url" aria-label="Адрес ссылки" value={href} onChange={(e) => setHref(e.target.value)} />
          <button type="button" className="ed-btn small" onClick={applyLink}>
            Поставить
          </button>
          <button type="button" className="ed-btn small" onClick={() => setLinkOpen(false)}>
            Отмена
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
      <label className="ed-field">
        <span>Вставить в текст</span>
        <select
          aria-label="Вставить в текст"
          value=""
          onChange={(e) => {
            if (e.target.value) insert(e.target.value);
          }}
        >
          <option value="">Переменную, баллы, ответ…</option>
          {variables.length > 0 && (
            <optgroup label="Переменные">
              {variables.map((v) => (
                <option key={v.id} value={`v:${v.id}`}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Системные значения">
            {TEXT_PLACEHOLDERS.map((p) => (
              <option key={p} value={`sys:${p}`}>
                {p}
              </option>
            ))}
          </optgroup>
          {questions.length > 0 && (
            <optgroup label="Ответ на вопрос">
              {questions.map((q) => (
                <option key={q.id} value={`answer:${q.id}`}>
                  {q.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {problem && (
        <p className="ed-hint" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
