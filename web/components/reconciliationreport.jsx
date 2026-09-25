import { For, Show } from "solid-js";

// Rapport de réconciliation HelloAsso (réponse de /api/admin/cotisants/import).
// En dry : bilan + non-résolus avec candidats, bouton « Appliquer » explicite
// (sémantique full-replace : on montre ce qui va changer AVANT d'écrire).
// En apply : bilan final, jamais un succès muet.
const HOW_LABEL = {
  "email": "email",
  "nom+prenom": "nom + prénom",
  "nom+initiale": "nom + initiale",
  "nom-compose": "nom composé",
  "ambigu": "ambigu",
  "introuvable": "introuvable",
};

export function ReconciliationReport(props) {
  const r = () => props.report;
  return (
    <div class="bg-black/5 rounded p-3 flex flex-col gap-2 text-sm">
      <div class="flex flex-wrap gap-2 items-baseline">
        <span class="font-bold">{r().total} cotisants dans le fichier</span>
        <Show when={props.applied} fallback={<span class="text-gray-600">· simulation, rien n'est encore écrit</span>}>
          <span class="text-green-700 font-semibold">· appliqué : {props.applied.cotisants} cotisants en base, dont {props.applied.phantoms} entrée{props.applied.phantoms > 1 ? "s" : ""} à rattacher</span>
        </Show>
      </div>
      <div class="flex flex-wrap gap-1">
        <span class="bg-vc/40 rounded-full px-2 py-0.5 text-xs">{r().matchedCount} apparié{r().matchedCount > 1 ? "s" : ""}</span>
        <For each={Object.entries(r().byHow)}>
          {([how, n]) => <span class="bg-black/10 rounded-full px-2 py-0.5 text-xs">{n} par {HOW_LABEL[how] || how}</span>}
        </For>
      </div>

      <Show when={r().unresolved.length > 0}>
        <div class="font-semibold">
          Non résolus ({r().unresolved.length}) — {props.applied ? "en base, à rattacher" : "deviendront des entrées à rattacher"}
        </div>
        <div class="flex flex-col gap-1 max-h-64 overflow-auto">
          <For each={r().unresolved}>
            {u => (
              <div class="bg-white rounded p-2 flex flex-col gap-1">
                <div>
                  <span class="font-semibold">{u.prenom} {u.nom}</span>
                  <Show when={u.email}><span class="text-xs text-gray-500"> · {u.email}</span></Show>
                  <span class="text-xs text-gray-500"> · {HOW_LABEL[u.how] || u.how}</span>
                </div>
                <Show when={u.suggestions?.length} fallback={
                  <span class="text-xs text-gray-500">Aucun candidat : corrige à la main dans la table (bouton « Valider l'entrée » ou édition).</span>
                }>
                  <div class="flex flex-wrap gap-1">
                    <For each={u.suggestions}>
                      {s => (
                        <Show when={props.onAttach} fallback={
                          <span class="text-xs border rounded-full px-2 py-0.5">{s.prenom} {s.nom} ({s.promo})</span>
                        }>
                          <button
                            class="text-xs bg-vc/40 hover:bg-vc/70 rounded-full px-2 py-0.5 cursor-pointer"
                            onClick={() => props.onAttach(u, s)}
                            title={`Rattacher ${u.prenom} ${u.nom} à ${s.prenom} ${s.nom} (${s.pxx})`}
                          >→ {s.prenom} {s.nom} ({s.promo})</button>
                        </Show>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={r().unresolved.length === 0}>
        <div class="text-green-700 font-semibold">Aucun non-résolu : tout le monde est apparié.</div>
      </Show>
    </div>
  );
}
