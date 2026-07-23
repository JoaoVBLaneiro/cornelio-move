import { registerRootComponent } from "expo";

import App from "./App";

// O FCM e a tela de corrida sao tratados pelo servico Android nativo gerado no prebuild.
// Nao crie outra notificacao Notifee aqui, pois isso reabriria a MainActivity/React.
registerRootComponent(App);
