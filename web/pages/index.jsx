import { MetaProvider, Title } from "@solidjs/meta";
import { Layout } from "../components/layout";
import logo from "../res/logo_bda.png"
import rezal from "../res/logo_rezal.svg"
import { LinkButton } from "../components/utils";

export default function App() {
  return (
    <Layout center={true}>
      <MetaProvider>
        <Title>BDA Mines Paris</Title>
      </MetaProvider>

      <div class="flex flex-row gap-2 items-center">
        <img width="96" src={logo} alt="Logo" class="shadow"/>
        <div>
          <div class="font-bold text-4xl">BDA Mines Paris</div>
          <div class="text-xl text-vf">Plateforme équi-PAPS</div>
        </div>
      </div>

      <p>Ce site est expérimental pour le moment ; si vous trouvez une erreur, merci de nous la signaler par mail :)</p>
      <a href="mailto:bureaudesarts.minesparis@gmail.com" class="text-vf">bureaudesarts.minesparis@gmail.com</a>

      <p><b>Objectif :</b> répartir les PAPS pour éviter des cas où certain.es mineur.euses n'ont pas pu profiter de suffisamment d'évènements.</p>

      <p><b>Concrètement :</b> priorisation des cotisants, puis de ceux qui ont le moins bénéficié de sorties BDA. (ordre lexicographique)</p>
      <p><i>Le BDA se réserve le droit de modifier la répartition des PAPS en cas de problème.</i></p>
      <LinkButton href="/listevents"><div class="bg-vf text-rc w-fit px-4 py-2 rounded">Liste des événements</div></LinkButton>
    
      <span class="flex flex-row gap-1 text-sm">Hébergé avec l'aimable participation de <a href="https://www.rezal-mdm.com" target="_blank" class="flex flex-row gap-1"><img src={rezal} width="16"/> rezal</a></span>
    </Layout>
  );
}
