import { createSignal, createResource, createEffect, Show } from "solid-js";
import { MetaProvider, Title } from "@solidjs/meta";
import { Layout } from "../components/layout";
import { BackButton, LinkButton } from "../components/utils";
import { isAdmin, adminLogin, adminLogout, adminHeaders } from "../res/admin";
import { ConfirmDialog } from "../components/confirmdialog";

async function fetchSummary() {
  const res = await fetch("/api/admin/summary", { headers: adminHeaders() });
  if (!res.ok) throw new Error("non autorisé");
  return await res.json();
}

function Stat(props) {
  return (
    <div class="bg-black/5 rounded p-3 text-center">
      <div class="text-2xl font-bold">{props.value}</div>
      <div class="text-xs text-gray-600">{props.label}</div>
    </div>
  );
}

export default function AdminPage() {
  const [password, setPassword] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [comptage, setComptage] = createSignal(null);
  const [fenetre, setFenetre] = createSignal(null);
  const [fenetreInput, setFenetreInput] = createSignal("");
  const [comptageDate, setComptageDate] = createSignal("");
  const [confirmComptage, setConfirmComptage] = createSignal(false);
  // Source réactive : dès que la session s'ouvre, le résumé se charge.
  const [summary] = createResource(() => (isAdmin() ? "on" : null), fetchSummary);

  // Référentiel de comptage + fenêtre prioritaire : chargés dès que la
  // session bureau est ouverte.
  createEffect(async () => {
    if (!isAdmin()) { setComptage(null); setFenetre(null); return; }
    try {
      const res = await fetch("/api/admin/comptage", { headers: adminHeaders() });
      if (res.ok) setComptage(await res.json());
    } catch (_) { /* réessayé au prochain affichage */ }
    try {
      const res = await fetch("/api/admin/fenetre", { headers: adminHeaders() });
      if (res.ok) setFenetre(await res.json());
    } catch (_) { /* réessayé au prochain affichage */ }
  });

  const saveFenetre = async (e) => {
    e.preventDefault();
    const h = parseInt(fenetreInput(), 10);
    if (!Number.isFinite(h) || h < 1) { setStatus("Choisis un nombre d'heures (1 min)."); return; }
    setStatus("Fenêtre mise à jour...");
    try {
      const res = await fetch("/api/admin/fenetre", {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ heures: h }),
      });
      if (res.status === 401) { setStatus("Session expirée. Reconnecte-toi."); return; }
      const j = await res.json();
      if (j.success === false) { setStatus(j.message || "Erreur."); return; }
      setFenetre(j);
      setFenetreInput("");
      setStatus(`Fenêtre prioritaire réglée à ${j.heures} h.`);
    } catch (_) {
      setStatus("Erreur lors du réglage de la fenêtre.");
    }
  };

  const applyComptage = async () => {
    setConfirmComptage(false);
    const d = comptageDate();
    if (!d) { setStatus("Choisis une date."); return; }
    setStatus("Référentiel mis à jour...");
    try {
      const res = await fetch("/api/admin/comptage", {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ depuis: new Date(d + "T00:00:00").toISOString() }),
      });
      if (res.status === 401) { setStatus("Session expirée. Reconnecte-toi."); return; }
      const j = await res.json();
      if (j.success === false) { setStatus(j.message || "Erreur."); return; }
      setComptage(j);
      setStatus(`Comptage depuis le ${new Date(j.depuis).toLocaleDateString()}.`);
    } catch (_) {
      setStatus("Erreur lors de la mise à jour du référentiel.");
    }
  };

  const clearComptage = async () => {
    setConfirmComptage(false);
    setStatus("Référentiel retiré...");
    try {
      const res = await fetch("/api/admin/comptage", {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ depuis: null }),
      });
      if (res.status === 401) { setStatus("Session expirée. Reconnecte-toi."); return; }
      const j = await res.json();
      if (j.success === false) { setStatus(j.message || "Erreur."); return; }
      setComptage(j);
      setStatus("Tout l'historique recompte.");
    } catch (_) {
      setStatus("Erreur lors de la mise à jour du référentiel.");
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setStatus("Connexion...");
    const ok = await adminLogin(password());
    if (ok) { setStatus(""); setPassword(""); }
    else setStatus("Mot de passe incorrect.");
  };

  return (
    <Layout floating={true}>
      <MetaProvider><Title>Admin - BDA équi-PAPS</Title></MetaProvider>
      <div class="flex flex-col w-full gap-3">
        <BackButton/>
        <h2 class="text-2xl font-bold">Espace bureau</h2>

        <Show
          when={isAdmin()}
          fallback={
            <form onSubmit={handleLogin} class="flex flex-col gap-3">
              <p class="text-gray-700">Connecte-toi avec le mot de passe du bureau.</p>
              <input
                type="password"
                placeholder="Mot de passe du bureau"
                value={password()}
                onInput={e => setPassword(e.target.value)}
                required
                class="border rounded p-2"
              />
              <button type="submit" class="bg-vf text-white rounded p-2 font-bold">Se connecter</button>
              {status() && <div class="text-center text-gray-700">{status()}</div>}
            </form>
          }
        >
          <p class="text-green-700">Connecté en tant que bureau.</p>
          <Show when={summary()}>
            <div class="grid grid-cols-3 gap-2">
              <Stat label="Événements" value={summary().events}/>
              <Stat label="Ouverts" value={summary().openEvents}/>
              <Stat label="Inscriptions" value={summary().inscriptions}/>
              <Stat label="Cotisants" value={summary().cotisants}/>
              <Stat label="Élèves" value={summary().roster}/>
              <Show when={summary().pending > 0}><Stat label="À rattacher" value={summary().pending}/></Show>
            </div>
          </Show>
          <Show when={isAdmin() && comptage()}>
            <div class="bg-black/5 rounded p-3">
              <div class="font-bold text-sm mb-1">Référentiel de comptage</div>
              <p class="text-xs text-gray-600 mb-2">Les participations comptent dans le tirage à partir de cette date. Rien n'est jamais effacé : seules les bornes du compteur bougent. À remonter chaque rentrée pour remettre les compteurs à l'équilibre.</p>
              <Show when={comptage().depuis} fallback={<div class="text-xs text-gray-600">Aucun référentiel posé : tout l'historique compte.</div>}>
                <div class="text-xs text-gray-600 mb-1">Comptage depuis le <span class="font-semibold">{new Date(comptage().depuis).toLocaleDateString()}</span></div>
              </Show>
              <form onSubmit={e => { e.preventDefault(); setConfirmComptage(true); }} class="flex gap-2 items-center flex-wrap">
                <input
                  type="date"
                  value={comptageDate()}
                  onInput={e => setComptageDate(e.target.value)}
                  required
                  class="border rounded p-2"
                />
                <button type="submit" class="bg-vf text-white rounded p-2 font-bold cursor-pointer text-sm">Faire compter à partir de cette date</button>
              </form>
              <Show when={comptage().depuis}>
                <button onClick={() => { setComptageDate(""); setConfirmComptage(true); }} class="text-xs underline text-gray-600 cursor-pointer mt-1">Recompter tout l'historique</button>
              </Show>
            </div>
          </Show>
          <Show when={isAdmin() && fenetre()}>
            <div class="bg-black/5 rounded p-3">
              <div class="font-bold text-sm mb-1">Fenêtre prioritaire</div>
              <p class="text-xs text-gray-600 mb-2">Durée pendant laquelle les inscrits sont triés par équité après l'ouverture. Passée la fenêtre : premier arrivé, premier servi. Visible par les élèves sur la page de l'événement.</p>
              <div class="text-xs text-gray-600 mb-1">Actuelle : <span class="font-semibold">{fenetre().heures} h</span></div>
              <form onSubmit={saveFenetre} class="flex gap-2 items-center flex-wrap">
                <input
                  type="number" min="1" max="168" required
                  placeholder="heures"
                  value={fenetreInput()}
                  onInput={e => setFenetreInput(e.target.value)}
                  class="border rounded p-2 w-24"
                />
                <button type="submit" class="bg-vf text-white rounded p-2 font-bold cursor-pointer text-sm">Régler</button>
              </form>
            </div>
          </Show>
          <div class="flex flex-col gap-2 mt-2">
            <LinkButton href="/createevent">Créer un événement</LinkButton>
            <LinkButton href="/listevents">Gérer les événements</LinkButton>
            <LinkButton href="/eleve">Élèves & cotisants</LinkButton>
          </div>
          <button
            onClick={() => adminLogout()}
            class="bg-black/60 text-white rounded p-2 font-bold mt-2 cursor-pointer"
          >Se déconnecter</button>
        </Show>
        <ConfirmDialog
          open={confirmComptage()}
          title="Déplacer le référentiel de comptage ?"
          onConfirm={comptageDate() ? applyComptage : clearComptage}
          onCancel={() => setConfirmComptage(false)}
        >
          <Show when={comptageDate()} fallback={<p>Tout l'historique recomptera pour le tirage. Aucune participation ne sera effacée.</p>}>
            <p>Les participations des événements antérieurs à cette date cesseront de compter pour le tirage. Aucune participation ne sera effacée.</p>
            <p>Nouveau référentiel : <span class="font-semibold">{comptageDate()}</span></p>
          </Show>
        </ConfirmDialog>
      </div>
    </Layout>
  );
}
