import { registerRootComponent } from "expo";
import messaging from "@react-native-firebase/messaging";
import notifee, { AndroidImportance, AndroidCategory, AndroidVisibility } from "@notifee/react-native";

import App from "./App";

const CANAL_CORRIDAS_URGENTES = "corridas-urgentes";

async function criarCanalCorridasUrgentes() {
  await notifee.createChannel({
    id: CANAL_CORRIDAS_URGENTES,
    name: "Corridas urgentes",
    importance: AndroidImportance.HIGH,
    sound: "default",
    vibration: true,
    vibrationPattern: [0, 800, 250, 800, 250, 800],
    lights: true,
    lightColor: "#facc15",
  });
}

function normalizarChamada(dados = {}) {
  if (typeof dados.chamada === "string") {
    try {
      return JSON.parse(dados.chamada);
    } catch (error) {
      return null;
    }
  }

  if (dados.chamada && typeof dados.chamada === "object") {
    return dados.chamada;
  }

  if (dados.idChamada) {
    return {
      idChamada: dados.idChamada,
      cliente: dados.cliente || "Cliente",
      endereco: dados.endereco || "Endereço não informado",
      observacao: dados.observacao || "",
      latitudePassageiro: dados.latitudePassageiro,
      longitudePassageiro: dados.longitudePassageiro,
      distancia: dados.distancia || "Distância a calcular",
      tempo: dados.tempo || "Tempo a calcular",
      origem: dados.origem || "Despacho",
      tokenTentativa: dados.tokenTentativa,
    };
  }

  return null;
}

async function mostrarTelaChamada(remoteMessage) {
  const dados = remoteMessage?.data || {};

  if (dados.tipo !== "nova_corrida_motorista") {
    return;
  }

  const chamada = normalizarChamada(dados);

  if (!chamada) {
    return;
  }

  await criarCanalCorridasUrgentes();

  const notificacaoId =
    dados.notificacaoId ||
    `corrida-${chamada.idChamada || Date.now()}-${chamada.tokenTentativa || "tentativa"}`;

  await notifee.displayNotification({
    id: notificacaoId,
    title: "Nova corrida",
    body: chamada.endereco || "Toque para atender",
    data: {
      ...dados,
      chamada: JSON.stringify(chamada),
      notificacaoId,
    },
    android: {
      channelId: CANAL_CORRIDAS_URGENTES,
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      sound: "default",
      vibrationPattern: [0, 800, 250, 800, 250, 800],
      autoCancel: false,
      ongoing: true,
      loopSound: true,
      color: "#facc15",
      smallIcon: "ic_launcher",
      pressAction: {
        id: "default",
        launchActivity: "default",
      },
      fullScreenAction: {
        id: "default",
        launchActivity: "default",
      },
      actions: [
        {
          title: "PULAR",
          pressAction: {
            id: "RECUSAR_CORRIDA",
            launchActivity: "default",
          },
        },
        {
          title: "ACEITAR",
          pressAction: {
            id: "ACEITAR_CORRIDA",
            launchActivity: "default",
          },
        },
      ],
    },
  });
}

messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  await mostrarTelaChamada(remoteMessage);
});

notifee.onBackgroundEvent(async ({ detail }) => {
  const dados = detail?.notification?.data || {};

  if (dados.tipo === "nova_corrida_motorista") {
    await notifee.cancelNotification(dados.notificacaoId || detail.notification?.id);
  }
});

registerRootComponent(App);
