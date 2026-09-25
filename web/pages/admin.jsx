import { createSignal, createResource, Show } from "solid-js";
import { MetaProvider, Title } from "@solidjs/meta";
import { Layout } from "../components/layout";
import { BackButton, LinkButton } from "../components/utils";
import { isAdmin, adminLogin, adminLogout, adminHeaders } from "../res/admin";

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
  // Source réactive : dès que la session s'ouvre, le résumé se charge.
  const [summary] = createResource(() => (isAdmin() ? "on" : null), fetchSummary);

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
      </div>
    </Layout>
  );
}
