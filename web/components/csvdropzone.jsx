import { createSignal, Show } from "solid-js";

// Zone de dépôt de fichier (drag & drop ou clic) pour les imports admin.
// Rien ne part tant que props.onFile n'est pas appelé : la page garde la
// main sur le dry-run puis l'apply.
export function CsvDropzone(props) {
  const [file, setFile] = createSignal(null);
  const [over, setOver] = createSignal(false);
  let input;

  const take = (f) => {
    if (!f) return;
    setFile(f);
    props.onFile?.(f);
  };

  return (
    <div
      class="border-2 border-dashed rounded p-4 text-center cursor-pointer transition-colors"
      classList={{ "border-vf bg-vc/20": over(), "border-gray-400 bg-black/5": !over() }}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
      onClick={() => input?.click()}
    >
      <input
        ref={input}
        type="file"
        accept={props.accept || ".csv"}
        class="hidden"
        onChange={e => take(e.target.files?.[0])}
      />
      <Show when={file()} fallback={
        <span class="text-sm text-gray-700">{props.label || "Dépose le fichier ici, ou clique pour choisir."}</span>
      }>
        <span class="text-sm font-semibold">{file().name}</span>
        <span class="text-xs text-gray-500"> ({Math.max(1, Math.round(file().size / 1024))} Ko)</span>
      </Show>
    </div>
  );
}
