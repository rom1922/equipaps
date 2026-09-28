import { createResource, For, Show } from "solid-js";
import { adminFetch } from "../res/admin";
import { promoLabel } from "./utils";
import { TypeChip } from "./phase";

// Fiche élève (bureau) : inscriptions et compteurs d'un élève du roster.
// Modale volontairement simple : ouverte par clic sur un nom de la table
// (adminroster.jsx), chargée en une requête /api/admin/eleve/:pxx, fermée
// par le bouton ou un clic sur le fond.
export function EleveDetail(props) {
  const [detail] = createResource(() => props.pxx, async (pxx) => {
    const res = await adminFetch(`/api/admin/eleve/${pxx}`);
    if (!res.ok) return null;
    return await res.json();
  });

  const compteur = (label, n, total) => (
    <div class="bg-black/5 rounded p-2 text-center">
      <div class="text-2xl font-bold">{total}</div>
      <div class="text-xs text-gray-600">{label}{n != null ? ` (dont ${n} dans le référentiel)` : ""}</div>
    </div>
  );

  return (
    <Show when={props.pxx}>
      <div class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => props.onClose()}>
        <div class="bg-white rounded-md shadow-lg p-4 max-w-md w-full max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
          <Show when={!detail.loading && detail()} fallback={<div class="text-center text-gray-600">Chargement…</div>}>
            <div class="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 class="font-bold text-lg">
                  {`${detail().eleve.prenom || ""} ${detail().eleve.nom || ""}`.trim() || "(sans nom)"}
                </h3>
                <div class="text-xs text-gray-500">
                  <Show when={detail().eleve.promo}>{promoLabel(detail().eleve.promo)} · </Show>
                  {detail().eleve.pxx}
                  <Show when={detail().eleve.cotisant}> · <span class="text-vf font-semibold">cotisant</span></Show>
                </div>
              </div>
              <button onClick={() => props.onClose()} class="text-gray-500 font-bold cursor-pointer">×</button>
            </div>

            <div class="grid grid-cols-2 gap-2 mb-3">
              {compteur("sorties obtenues", detail().depuisReferentiel?.sortie, detail().totaux.sortie)}
              {compteur("ateliers obtenus", detail().depuisReferentiel?.atelier, detail().totaux.atelier)}
            </div>
            <Show when={detail().comptageDepuis} fallback={<p class="text-xs text-gray-500 mb-3">Aucun référentiel de comptage posé : tout l'historique compte.</p>}>
              <p class="text-xs text-gray-500 mb-3">Référentiel de comptage : depuis le {new Date(detail().comptageDepuis).toLocaleDateString()}.</p>
            </Show>

            <div class="font-semibold text-sm mb-1">Événements inscrits ({detail().evenements.length})</div>
            <Show
              when={detail().evenements.length > 0}
              fallback={<p class="text-xs text-gray-500">Aucune inscription.</p>}
            >
              <div class="flex flex-col gap-1">
                <For each={detail().evenements}>
                  {(ev) => (
                    <div class="flex items-center gap-2 rounded px-2 py-1 bg-black/5">
                      <span class="text-xs text-gray-500 w-24 shrink-0">{new Date(ev.date).toLocaleDateString()}</span>
                      <span class="text-sm truncate flex-grow">{ev.name}</span>
                      <TypeChip ev={ev}/>
                      <span class="text-xs shrink-0 font-semibold" classList={{ "text-vf": ev.obtenu, "text-gray-400": !ev.obtenu }}>
                        {ev.obtenu ? "✓ obtenue" : "non obtenue"}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </Show>
  );
}
