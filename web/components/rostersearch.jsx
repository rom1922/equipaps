import { createSignal, For, Show, onCleanup } from "solid-js";
import { promoLabel } from "./utils";

// Recherche floue par nom sur le roster (annuaire PDM), même approche que Pain
// de Mine. L'élève tape son nom -> suggestions (nom + promo + login pour lever
// les homonymes) -> il choisit, onSelect reçoit { pxx, prenom, nom, promo }.
// Réutilisé par l'inscription publique (event.jsx) et l'admin (editevent.jsx).
export function RosterSearch(props) {
  const [q, setQ] = createSignal("");
  const [results, setResults] = createSignal([]);
  const [open, setOpen] = createSignal(false);
  let timer, ctrl;

  const runSearch = (value) => {
    clearTimeout(timer);
    if (ctrl) ctrl.abort();
    if (value.trim().length < 2) { setResults([]); setOpen(false); return; }
    timer = setTimeout(async () => {
      try {
        ctrl = new AbortController();
        const res = await fetch(`/api/roster/search?q=${encodeURIComponent(value.trim())}`, { signal: ctrl.signal });
        if (!res.ok) return;
        setResults(await res.json());
        setOpen(true);
      } catch (_) { /* aborted / réseau : on ignore */ }
    }, 180);
  };

  onCleanup(() => { clearTimeout(timer); if (ctrl) ctrl.abort(); });

  const pick = (r) => {
    setQ(`${r.prenom || ""} ${r.nom || ""}`.trim());
    setResults([]);
    setOpen(false);
    props.onSelect?.(r);
  };

  return (
    <div class="form-group-autocomplete relative">
      <input
        type="text"
        placeholder={props.placeholder || "Ton nom (comme sur le portail)"}
        value={q()}
        onInput={e => { setQ(e.target.value); props.onInput?.(); runSearch(e.target.value); }}
        onFocus={() => results().length && setOpen(true)}
        autocomplete="off"
        class="border rounded p-2 w-full"
      />
      <Show when={open() && results().length > 0}>
        <div class="suggestions-list absolute z-10 left-0 right-0 bg-white border rounded shadow max-h-64 overflow-auto">
          <For each={results()}>
            {(r) => (
              <div
                class="suggestion-item flex justify-between items-center px-3 py-2 cursor-pointer hover:bg-vc/20"
                onClick={() => pick(r)}
              >
                <span class="suggestion-name">{`${r.prenom || ""} ${r.nom || ""}`.trim()}</span>
                <span class="suggestion-promo text-xs text-gray-500 ml-2">{promoLabel(r.promo) || "P?"} · {r.pxx}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
