import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { MetaProvider, Title } from "@solidjs/meta";
import { Layout } from "../components/layout";
import { BackButton, LinkButton, promoLabel } from "../components/utils";
import { isAdmin, adminFetch } from "../res/admin";
import { CsvDropzone } from "../components/csvdropzone";
import { ReconciliationReport } from "../components/reconciliationreport";

async function fetchSummary() {
  const res = await adminFetch("/api/admin/summary");
  if (!res.ok) throw new Error("non autorisé");
  return await res.json();
}

// Gestion des élèves et cotisants depuis le bureau : table complète,
// édition à la volée, import HelloAsso (dry puis apply), sync portail,
// rattachement des non-résolus. Plus jamais de script lancé sur le serveur.
export default function AdminRosterPage() {
  const [summary, { refetch: refetchSummary }] = createResource(() => (isAdmin() ? "on" : null), fetchSummary);

  // --- Portail des élèves (sync automatique) ---
  const [portailKey, setPortailKey] = createSignal(null);
  const [portailKeyInput, setPortailKeyInput] = createSignal("");
  const [portailStatus, setPortailStatus] = createSignal("");
  const [syncRapport, setSyncRapport] = createSignal(null);
  const [syncing, setSyncing] = createSignal(false);

  const loadPortailKey = async () => {
    const res = await adminFetch("/api/admin/portail/key");
    if (res.ok) setPortailKey(await res.json());
  };

  const savePortailKey = async (e) => {
    e.preventDefault();
    setPortailStatus("");
    const res = await adminFetch("/api/admin/portail/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cle: portailKeyInput() }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setPortailStatus(j.message || "Clé refusée."); return; }
    setPortailKeyInput("");
    setPortailStatus("Clé enregistrée.");
    await loadPortailKey();
  };

  const syncPortail = async () => {
    setSyncing(true);
    setPortailStatus("Synchronisation...");
    setSyncRapport(null);
    try {
      const res = await adminFetch("/api/admin/roster/sync-portail", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setPortailStatus(j.message || "Échec de la synchronisation."); return; }
      setPortailStatus("");
      setSyncRapport(j.rapport);
      await loadRoster(); refetchSummary();
    } finally {
      setSyncing(false);
    }
  };

  // --- Table roster ---
  const [rows, setRows] = createSignal([]);
  const [total, setTotal] = createSignal(0);
  const [pages, setPages] = createSignal(1);
  const [q, setQ] = createSignal("");
  const [filter, setFilter] = createSignal("all");
  const [page, setPage] = createSignal(1);
  const [tableStatus, setTableStatus] = createSignal("");
  const [editing, setEditing] = createSignal(null);
  const [draft, setDraft] = createSignal({});
  const [showAdd, setShowAdd] = createSignal(false);
  const [newPerson, setNewPerson] = createSignal({ prenom: "", nom: "", email: "", promo: "", cotisant: false });

  const loadRoster = async () => {
    const res = await adminFetch(`/api/admin/roster?q=${encodeURIComponent(q())}&filter=${filter()}&page=${page()}`);
    if (!res.ok) return;
    const j = await res.json();
    setRows(j.rows); setTotal(j.total); setPage(j.page); setPages(j.pages);
  };

  // Le tableau se recharge dès qu'un filtre change (recherche, onglet, page).
  // Le filtrage serveur travaille sur le cache mémoire : une requête par
  // frappe reste négligeable, pas de debounce à maintenir.
  createEffect(() => {
    if (!isAdmin()) return;
    q(); filter(); page();
    loadRoster();
    loadPortailKey();
  });

  const onSearch = (v) => {
    setQ(v);
    setPage(1);
  };

  const setFilterAndReset = (f) => { setFilter(f); setPage(1); };

  const startEdit = (r) => {
    setEditing(r.pxx);
    setDraft({ prenom: r.prenom || "", nom: r.nom || "", email: r.email || "", promo: r.promo || "" });
  };

  const saveEdit = async () => {
    const res = await adminFetch("/api/admin/roster/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pxx: editing(), ...draft() }),
    });
    if (!res.ok) { setTableStatus("Édition refusée."); return; }
    setEditing(null);
    await loadRoster(); refetchSummary();
  };

  const toggleCotisant = async (r) => {
    const res = await adminFetch("/api/admin/roster/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pxx: r.pxx, cotisant: !r.cotisant }),
    });
    if (!res.ok) { setTableStatus("Changement refusé."); return; }
    await loadRoster(); refetchSummary();
  };

  const finalizeRow = async (r) => {
    const res = await adminFetch("/api/admin/roster/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pxx: r.pxx, finalize: true }),
    });
    if (!res.ok) { setTableStatus("Validation refusée."); return; }
    await loadRoster(); refetchSummary();
  };

  const attach = async (fromPxx, toPxx) => {
    const res = await adminFetch("/api/admin/cotisants/attach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromPxx, toPxx }),
    });
    const j = await res.json().catch(() => ({}));
    setTableStatus(res.ok ? "Rattaché." : (j.message || "Rattachement refusé."));
    await loadRoster(); refetchSummary();
  };

  const addPerson = async () => {
    const res = await adminFetch("/api/admin/roster/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newPerson()),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setTableStatus(j.message || "Ajout refusé."); return; }
    setTableStatus(`Ajouté : ${j.pxx}.`);
    setShowAdd(false);
    setNewPerson({ prenom: "", nom: "", email: "", promo: "", cotisant: false });
    await loadRoster(); refetchSummary();
  };

  // --- Import HelloAsso ---
  let cotisantsFile = null;
  const [cotReport, setCotReport] = createSignal(null);
  const [cotApplied, setCotApplied] = createSignal(null);
  const [cotStatus, setCotStatus] = createSignal("");
  const [cotFileOk, setCotFileOk] = createSignal(false);

  const onCotisantsFile = (f) => {
    cotisantsFile = f;
    setCotFileOk(true);
    setCotReport(null); setCotApplied(null); setCotStatus("");
  };

  const runCotisants = async (mode) => {
    if (!cotisantsFile) return;
    setCotStatus(mode === "apply" ? "Application..." : "Analyse...");
    const fd = new FormData();
    fd.append("csv", cotisantsFile);
    fd.append("mode", mode);
    const res = await adminFetch("/api/admin/cotisants/import", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setCotStatus(j.message || "Erreur d'import."); return; }
    setCotReport(j.report); setCotStatus("");
    if (mode === "apply") {
      setCotApplied({ cotisants: j.cotisants, phantoms: j.phantoms });
      await loadRoster(); refetchSummary();
    }
  };

  const pending = () => (filter() === "pending");

  return (
    <Layout>
      <MetaProvider><Title>Élèves & cotisants - BDA équi-PAPS</Title></MetaProvider>
      <div class="flex flex-col w-full gap-3">
        <BackButton/>
        <h2 class="text-2xl font-bold">Élèves & cotisants</h2>

        <Show
          when={isAdmin()}
          fallback={<p class="text-gray-700">Réservé au bureau. <LinkButton href="/admin">Se connecter</LinkButton></p>}
        >
          {/* Stats */}
          <Show when={summary()}>
            <div class="grid grid-cols-3 gap-2">
              <div class="bg-black/5 rounded p-3 text-center">
                <div class="text-2xl font-bold">{summary().roster}</div>
                <div class="text-xs text-gray-600">élèves en base</div>
              </div>
              <div class="bg-black/5 rounded p-3 text-center">
                <div class="text-2xl font-bold">{summary().cotisants}</div>
                <div class="text-xs text-gray-600">cotisants</div>
              </div>
              <div class="bg-black/5 rounded p-3 text-center">
                <div class="text-2xl font-bold" classList={{ "text-rf": summary().pending > 0 }}>{summary().pending}</div>
                <div class="text-xs text-gray-600">à rattacher</div>
              </div>
            </div>
          </Show>

          {/* Import HelloAsso */}
          <div class="bg-black/5 rounded p-3 flex flex-col gap-2">
            <div class="font-semibold">Import HelloAsso</div>
            <CsvDropzone label="Dépose l'export CSV HelloAsso." accept=".csv" onFile={onCotisantsFile}/>
            <Show when={cotFileOk()}>
              <div class="flex gap-2">
                <button
                  onClick={() => runCotisants("dry")}
                  disabled={!!cotStatus()}
                  class="border rounded p-2 font-bold cursor-pointer disabled:opacity-50"
                >Analyser (sans écrire)</button>
                <Show when={cotReport() && !cotApplied()}>
                  <button
                    onClick={() => runCotisants("apply")}
                    disabled={!!cotStatus()}
                    class="bg-vf text-white rounded p-2 font-bold cursor-pointer disabled:opacity-50"
                  >Appliquer l'import</button>
                </Show>
              </div>
            </Show>
            {cotStatus() && <div class="text-sm">{cotStatus()}</div>}
            <Show when={cotReport()}>
              <ReconciliationReport report={cotReport()} applied={cotApplied()}/>
            </Show>
          </div>

          {/* Portail des élèves (sync automatique) */}
          <div class="bg-black/5 rounded p-3 flex flex-col gap-2">
            <div class="font-semibold">Portail des élèves</div>
            <Show when={portailKey()} fallback={<span class="text-xs text-gray-500">Clé API : état inconnu…</span>}>
              <div class="text-sm">
                <Show when={portailKey().definie} fallback={<span class="text-rf font-semibold">Aucune clé API déposée.</span>}>
                  <span class="text-green-700 font-semibold">Clé déposée : ••••{portailKey().dernier4}</span>
                  <span class="text-xs text-gray-500"> (le {new Date(portailKey().maj_at).toLocaleDateString()})</span>
                </Show>
              </div>
            </Show>
            <form onSubmit={savePortailKey} class="flex gap-2">
              <input
                type="password"
                placeholder="Clé API du portail (pak_…)"
                value={portailKeyInput()}
                onInput={e => setPortailKeyInput(e.target.value)}
                class="border rounded p-2 flex-grow"
                autocomplete="off"
              />
              <button type="submit" disabled={!portailKeyInput()} class="border rounded px-3 font-bold cursor-pointer disabled:opacity-50">Enregistrer la clé</button>
            </form>
            <div class="flex items-center gap-2 flex-wrap">
              <button
                onClick={syncPortail}
                disabled={!portailKey()?.definie || syncing()}
                class="bg-vf text-white rounded p-2 font-bold cursor-pointer disabled:opacity-50"
              >Synchroniser depuis le portail</button>
              <Show when={syncRapport()}>
                <span class="text-sm text-green-700 font-semibold">
                  {syncRapport().annuaire} élèves · {syncRapport().misAJour} mis à jour · {syncRapport().nouveaux} nouveaux
                </span>
              </Show>
            </div>
            {portailStatus() && <div class="text-sm">{portailStatus()}</div>}
          </div>

          {/* Table roster */}
          <div class="flex flex-col gap-2">
            <div class="flex flex-wrap gap-2 items-center">
              <input
                type="text"
                placeholder="Rechercher (nom, pxx)..."
                value={q()}
                onInput={e => onSearch(e.target.value)}
                class="border rounded p-2 flex-grow"
              />
              <div class="flex gap-1">
                <button classList={{ "bg-vf text-white": filter() === "all", "border": filter() !== "all" }} class="rounded px-3 py-2 text-sm font-bold cursor-pointer" onClick={() => setFilterAndReset("all")}>Tous</button>
                <button classList={{ "bg-vf text-white": filter() === "cotisants", "border": filter() !== "cotisants" }} class="rounded px-3 py-2 text-sm font-bold cursor-pointer" onClick={() => setFilterAndReset("cotisants")}>Cotisants</button>
                <button classList={{ "bg-vf text-white": pending(), "border": !pending() }} class="rounded px-3 py-2 text-sm font-bold cursor-pointer" onClick={() => setFilterAndReset("pending")}>À rattacher</button>
              </div>
              <button onClick={() => setShowAdd(v => !v)} class="border rounded px-3 py-2 text-sm font-bold cursor-pointer">+ Ajouter</button>
            </div>

            <Show when={showAdd()}>
              <form onSubmit={(e) => { e.preventDefault(); addPerson(); }} class="bg-black/5 rounded p-3 flex flex-wrap gap-2 items-end">
                <label class="text-xs flex flex-col gap-1">Prénom
                  <input required class="border rounded p-2" value={newPerson().prenom} onInput={e => setNewPerson({ ...newPerson(), prenom: e.target.value })}/>
                </label>
                <label class="text-xs flex flex-col gap-1">Nom
                  <input required class="border rounded p-2" value={newPerson().nom} onInput={e => setNewPerson({ ...newPerson(), nom: e.target.value })}/>
                </label>
                <label class="text-xs flex flex-col gap-1">Email
                  <input type="email" class="border rounded p-2" value={newPerson().email} onInput={e => setNewPerson({ ...newPerson(), email: e.target.value })}/>
                </label>
                <label class="text-xs flex flex-col gap-1">Promo
                  <input class="border rounded p-2 w-16" value={newPerson().promo} onInput={e => setNewPerson({ ...newPerson(), promo: e.target.value })}/>
                </label>
                <label class="text-xs flex items-center gap-1 p-2">cotisant
                  <input type="checkbox" checked={newPerson().cotisant} onChange={e => setNewPerson({ ...newPerson(), cotisant: e.target.checked })}/>
                </label>
                <button type="submit" class="bg-vf text-white rounded p-2 font-bold cursor-pointer">Ajouter</button>
              </form>
            </Show>

            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-xs text-gray-600 border-b">
                    <th class="p-1">Élève</th>
                    <th class="p-1">pxx</th>
                    <th class="p-1">Email</th>
                    <th class="p-1">Cotisant</th>
                    <th class="p-1"></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={rows()}>
                    {(r) => (
                      <Show
                        when={editing() !== r.pxx}
                        fallback={
                          <tr class="bg-vc/20">
                            <td class="p-1"><input class="border rounded p-1 w-full" value={draft().prenom} onInput={e => setDraft({ ...draft(), prenom: e.target.value })} placeholder="prénom"/></td>
                            <td class="p-1"><input class="border rounded p-1 w-full" value={draft().nom} onInput={e => setDraft({ ...draft(), nom: e.target.value })} placeholder="nom"/></td>
                            <td class="p-1"><input class="border rounded p-1 w-full" value={draft().email} onInput={e => setDraft({ ...draft(), email: e.target.value })} placeholder="email"/></td>
                            <td class="p-1"><input class="border rounded p-1 w-14" value={draft().promo} onInput={e => setDraft({ ...draft(), promo: e.target.value })} placeholder="promo"/></td>
                            <td class="p-1 flex gap-1">
                              <button onClick={saveEdit} class="bg-vf text-white rounded px-2 py-1 font-bold cursor-pointer">OK</button>
                              <button onClick={() => setEditing(null)} class="border rounded px-2 py-1 cursor-pointer">Annuler</button>
                            </td>
                          </tr>
                        }
                      >
                        <tr classList={{ "bg-yellow-100": pending(), "": !pending() }} class="border-b border-black/5">
                          <td class="p-1">
                            <span class="font-semibold">{r.prenom || r.nom ? `${r.prenom || ""} ${r.nom || ""}`.trim() : <span class="italic text-gray-500">(sans nom)</span>}</span>
                            <Show when={r.promo}><span class="text-xs text-gray-500"> · {promoLabel(r.promo)}</span></Show>
                          </td>
                          <td class="p-1 text-xs text-gray-500">{r.pxx}</td>
                          <td class="p-1 text-xs text-gray-600 max-w-40 truncate">{r.email}</td>
                          <td class="p-1">
                            <button
                              onClick={() => toggleCotisant(r)}
                              class="cursor-pointer text-xs font-bold"
                              classList={{ "text-vf": r.cotisant, "text-gray-400": !r.cotisant }}
                              title={r.cotisant ? "Retirer le statut cotisant" : "Marquer cotisant"}
                            >{r.cotisant ? "cotisant" : "—"}</button>
                          </td>
                          <td class="p-1 flex flex-wrap gap-1 items-center justify-end">
                            <Show when={!r.searchable}>
                              <span class="text-xs bg-yellow-200 rounded-full px-2 py-0.5">à rattacher</span>
                              <For each={r.suggestions || []}>
                                {(s) => (
                                  <button
                                    onClick={() => attach(r.pxx, s.pxx)}
                                    class="text-xs bg-vc/40 hover:bg-vc/70 rounded-full px-2 py-0.5 cursor-pointer"
                                    title={`Rattacher à ${s.prenom} ${s.nom} (${s.pxx})`}
                                  >→ {s.prenom} {s.nom}</button>
                                )}
                              </For>
                              <button onClick={() => finalizeRow(r)} class="text-xs border rounded-full px-2 py-0.5 cursor-pointer" title="En faire une vraie entrée cherchable">Valider l'entrée</button>
                            </Show>
                            <button onClick={() => startEdit(r)} class="text-xs border rounded px-2 py-0.5 cursor-pointer">Éditer</button>
                          </td>
                        </tr>
                      </Show>
                    )}
                  </For>
                </tbody>
              </table>
            </div>

            <div class="flex items-center justify-between text-sm">
              <span class="text-gray-600">{total()} rangée{total() > 1 ? "s" : ""}</span>
              <div class="flex gap-2 items-center">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page() <= 1}
                  class="border rounded px-2 py-1 cursor-pointer disabled:opacity-40"
                >←</button>
                <span class="text-gray-600">page {page()} / {pages()}</span>
                <button
                  onClick={() => setPage(p => Math.min(pages(), p + 1))}
                  disabled={page() >= pages()}
                  class="border rounded px-2 py-1 cursor-pointer disabled:opacity-40"
                >→</button>
              </div>
            </div>
            {tableStatus() && <div class="text-center">{tableStatus()}</div>}
          </div>
        </Show>
      </div>
    </Layout>
  );
}
