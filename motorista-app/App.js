import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import notifee, { EventType, AndroidImportance, AndroidCategory, AndroidVisibility } from "@notifee/react-native";
import messaging from "@react-native-firebase/messaging";
import { io } from "socket.io-client";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const CATEGORIA_CORRIDA = "corrida";
const CANAL_CORRIDAS = "corridas";
const CANAL_CORRIDAS_URGENTES = "corridas-urgentes";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const socketRef = useRef(null);
  const locationWatcherRef = useRef(null);
  const desejaFicarOnlineRef = useRef(false);
  const onlineRef = useRef(false);
  const motoristaLogadoRef = useRef(null);
  const tokenSessaoRef = useRef(null);
  const restaurandoOnlineRef = useRef(false);
  const expoPushTokenRef = useRef(null);
  const fcmTokenRef = useRef(null);

  const [conectado, setConectado] = useState(false);
  const [online, setOnline] = useState(false);
  const [localizacao, setLocalizacao] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [chamadaAtual, setChamadaAtual] = useState(null);
  const [corridaAceita, setCorridaAceita] = useState(false);
  const [modoLocalizacao, setModoLocalizacao] = useState("economico");

  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [motoristaLogado, setMotoristaLogado] = useState(null);
  const [tokenSessao, setTokenSessao] = useState(null);
  const [statusPush, setStatusPush] = useState("Configurando notificações...");
  const [statusFcm, setStatusFcm] = useState("Preparando chamada em tela cheia...");

  async function configurarNotificacoesPush() {
    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync(CANAL_CORRIDAS, {
          name: "Corridas",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 500, 250, 500, 250, 500],
          lightColor: "#22c55e",
          sound: "default",
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      }

      await Notifications.setNotificationCategoryAsync(CATEGORIA_CORRIDA, [
        {
          identifier: "ACEITAR_CORRIDA",
          buttonTitle: "ACEITAR",
          options: {
            opensAppToForeground: true,
          },
        },
        {
          identifier: "RECUSAR_CORRIDA",
          buttonTitle: "RECUSAR",
          options: {
            opensAppToForeground: true,
            isDestructive: true,
          },
        },
      ]);

      const permissaoAtual = await Notifications.getPermissionsAsync();
      let statusFinal = permissaoAtual.status;

      if (statusFinal !== "granted") {
        const novaPermissao = await Notifications.requestPermissionsAsync();
        statusFinal = novaPermissao.status;
      }

      if (statusFinal !== "granted") {
        expoPushTokenRef.current = null;
        setStatusPush("Notificações bloqueadas no celular");
        return null;
      }

      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;

      if (!projectId) {
        expoPushTokenRef.current = null;
        setStatusPush("Sem projectId do EAS");
        console.log("Project ID do EAS não encontrado no app.");
        return null;
      }

      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      expoPushTokenRef.current = token;
      setStatusPush("Notificações ativas");
      console.log("ExpoPushToken motorista:", token);
      return token;
    } catch (error) {
      expoPushTokenRef.current = null;
      setStatusPush("Erro push: " + error.message); Alert.alert("Erro push", error.message);
      console.log("Erro ao configurar push notification:", error.message);
      return null;
    }
  }


  async function configurarCanalCorridasUrgentes() {
    if (Platform.OS !== "android") {
      return;
    }

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

  async function configurarFcmDireto() {
    try {
      await configurarCanalCorridasUrgentes();
      await notifee.requestPermission();

      const authStatus = await messaging().requestPermission();
      const autorizado =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (!autorizado && Platform.OS !== "android") {
        fcmTokenRef.current = null;
        setStatusFcm("FCM não autorizado");
        return null;
      }

      const token = await messaging().getToken();

      fcmTokenRef.current = token;
      setStatusFcm("Tela cheia preparada");
      console.log("FCM token motorista:", token);

      return token;
    } catch (error) {
      fcmTokenRef.current = null;
      setStatusFcm("Erro FCM: " + error.message);
      console.log("Erro ao configurar FCM direto:", error.message);
      return null;
    }
  }

  function obterChamadaDeDadosNativos(dados = {}) {
    const bruto = dados?.chamada;

    if (typeof bruto === "string") {
      try {
        return JSON.parse(bruto);
      } catch (error) {
        console.log("Falha ao interpretar chamada nativa:", error.message);
      }
    }

    if (bruto && typeof bruto === "object") {
      return bruto;
    }

    if (dados?.idChamada) {
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

  async function tratarChamadaNativa(dados = {}, actionId = "default") {
    const chamada = obterChamadaDeDadosNativos(dados);

    if (!chamada) {
      return;
    }

    try {
      const notificationId =
        dados.notificacaoId ||
        dados.notificationId ||
        `corrida-${chamada.idChamada || "atual"}-${chamada.tokenTentativa || "tentativa"}`;

      await notifee.cancelNotification(notificationId);
    } catch (error) {
      console.log("Não foi possível remover notificação da corrida:", error.message);
    }

    if (actionId === "ACEITAR_CORRIDA") {
      setChamadaAtual(chamada);
      setCorridaAceita(false);
      await aceitarChamadaObjeto(chamada);
      return;
    }

    if (actionId === "RECUSAR_CORRIDA") {
      setChamadaAtual(chamada);
      setCorridaAceita(false);
      recusarChamadaObjeto(chamada);
      return;
    }

    setChamadaAtual(chamada);
    setCorridaAceita(false);
  }

  function obterChamadaDaNotificacao(response) {
    const dados = response?.notification?.request?.content?.data || {};
    return dados.chamada || null;
  }

  async function aceitarChamadaObjeto(chamada) {
    const motoristaAtual = motoristaLogadoRef.current;

    if (!chamada || !motoristaAtual || !socketRef.current || !socketRef.current.connected) {
      Alert.alert(
        "Não foi possível aceitar",
        "Abra o app, confirme a conexão e tente novamente."
      );
      return;
    }

    setChamadaAtual(chamada);
    setCorridaAceita(false);

    socketRef.current.emit(
      "aceitar_chamada",
      {
        idChamada: chamada.idChamada,
        tokenTentativa: chamada.tokenTentativa,
        idMotorista: motoristaAtual.login,
        nomeMotorista: motoristaAtual.nome,
        endereco: chamada.endereco,
      },
      async (resposta) => {
        if (!resposta || !resposta.ok) {
          Alert.alert(
            "Chamada indisponível",
            resposta?.mensagem || "Essa chamada não está mais disponível."
          );

          setChamadaAtual(null);
          setCorridaAceita(false);

          if (onlineRef.current) {
            await iniciarMonitoramentoLocalizacao("economico");
          }

          return;
        }

        await iniciarMonitoramentoLocalizacao("alta_precisao");
        setChamadaAtual(chamada);
        setCorridaAceita(true);
      }
    );
  }

  function recusarChamadaObjeto(chamada) {
    const motoristaAtual = motoristaLogadoRef.current;

    if (!chamada || !motoristaAtual || !socketRef.current || !socketRef.current.connected) {
      return;
    }

    socketRef.current.emit("recusar_chamada", {
      idChamada: chamada.idChamada,
      tokenTentativa: chamada.tokenTentativa,
      idMotorista: motoristaAtual.login,
      nomeMotorista: motoristaAtual.nome,
      endereco: chamada.endereco,
    });

    setChamadaAtual(null);
    setCorridaAceita(false);
  }

  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  useEffect(() => {
    motoristaLogadoRef.current = motoristaLogado;
  }, [motoristaLogado]);

  useEffect(() => {
    tokenSessaoRef.current = tokenSessao;
  }, [tokenSessao]);

  useEffect(() => {
    configurarNotificacoesPush();
    configurarFcmDireto();

    const respostaInicial = Notifications.getLastNotificationResponse();
    if (respostaInicial) {
      tratarRespostaNotificacao(respostaInicial);
      Notifications.clearLastNotificationResponse();
    }

    notifee.getInitialNotification().then((initialNotification) => {
      if (initialNotification?.notification?.data) {
        tratarChamadaNativa(
          initialNotification.notification.data,
          initialNotification.pressAction?.id || "default"
        );
      }
    }).catch((error) => {
      console.log("Erro ao verificar notificação inicial:", error.message);
    });

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      tratarRespostaNotificacao(response);
      Notifications.clearLastNotificationResponse();
    });

    const unsubscribeNotifee = notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS || type === EventType.ACTION_PRESS) {
        tratarChamadaNativa(
          detail.notification?.data || {},
          detail.pressAction?.id || "default"
        );
      }
    });

    const unsubscribeFcmForeground = messaging().onMessage(async (remoteMessage) => {
      const dados = remoteMessage?.data || {};

      if (dados.tipo === "nova_corrida_motorista") {
        await tratarChamadaNativa(dados, "default");
      }
    });

    const unsubscribeToken = messaging().onTokenRefresh((novoToken) => {
      fcmTokenRef.current = novoToken;
      setStatusFcm("Tela cheia preparada");

      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit("atualizar_fcm_token", {
          fcmToken: novoToken,
        });
      }
    });

    return () => {
      subscription.remove();
      unsubscribeNotifee();
      unsubscribeFcmForeground();
      unsubscribeToken();
    };
  }, []);

  async function tratarRespostaNotificacao(response) {
    const actionId = response?.actionIdentifier;
    const chamada = obterChamadaDaNotificacao(response);

    if (!chamada) {
      return;
    }

    if (actionId === "ACEITAR_CORRIDA") {
      await aceitarChamadaObjeto(chamada);
      return;
    }

    if (actionId === "RECUSAR_CORRIDA") {
      recusarChamadaObjeto(chamada);
      return;
    }

    setChamadaAtual(chamada);
    setCorridaAceita(false);
  }

  useEffect(() => {
    if (!BACKEND_URL) {
      Alert.alert(
        "Configuração incompleta",
        "Configure EXPO_PUBLIC_BACKEND_URL no arquivo .env do app motorista."
      );
      return;
    }

    socketRef.current = io(BACKEND_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 10000,
    });

    socketRef.current.on("connect", () => {
      setConectado(true);
      console.log("Conectado ao backend:", socketRef.current.id);

      if (
        desejaFicarOnlineRef.current &&
        motoristaLogadoRef.current &&
        tokenSessaoRef.current
      ) {
        restaurarOnlineAutomaticamente();
      }
    });

    socketRef.current.on("disconnect", () => {
      setConectado(false);
      console.log("Desconectado do backend");

      if (onlineRef.current) {
        onlineRef.current = false;
        setOnline(false);
      }
    });

    socketRef.current.on("connect_error", (error) => {
      setConectado(false);
      console.log("Erro Socket.IO:", error.message);

      if (onlineRef.current) {
        onlineRef.current = false;
        setOnline(false);
      }
    });

    socketRef.current.on("auth_erro", async (dados) => {
      Alert.alert("Sessão inválida", dados.mensagem || "Faça login novamente.");
      await sairDaConta(true);
    });

    socketRef.current.on("nova_chamada", (chamada) => {
      setChamadaAtual(chamada);
      setCorridaAceita(false);
    });

    socketRef.current.on("cancelar_chamada", (dados) => {
      setChamadaAtual((chamadaAtualAnterior) => {
        if (
          chamadaAtualAnterior &&
          chamadaAtualAnterior.idChamada === dados.idChamada
        ) {
          setCorridaAceita(false);
          Alert.alert("Chamada cancelada", dados.mensagem);
          return null;
        }

        return chamadaAtualAnterior;
      });
    });

    socketRef.current.on("chamada_indisponivel", (dados) => {
      setChamadaAtual((chamadaAtualAnterior) => {
        if (
          chamadaAtualAnterior &&
          chamadaAtualAnterior.idChamada === dados.idChamada
        ) {
          setCorridaAceita(false);
          Alert.alert("Chamada indisponível", dados.mensagem);
          return null;
        }

        return chamadaAtualAnterior;
      });
    });

    socketRef.current.on("corrida_cancelada_motorista", async (dados) => {
      setCorridaAceita(false);
      setChamadaAtual((chamadaAtualAnterior) => {
        if (
          chamadaAtualAnterior &&
          chamadaAtualAnterior.idChamada === dados.idChamada
        ) {
          Alert.alert("Corrida cancelada", dados.mensagem || "Corrida cancelada.");
          return null;
        }

        return chamadaAtualAnterior;
      });

      await iniciarMonitoramentoLocalizacao("economico");
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }

      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove();
        locationWatcherRef.current = null;
      }
    };
  }, []);

  async function entrarNaConta() {
    const loginLimpo = login.trim();

    if (!BACKEND_URL) {
      Alert.alert("Configuração incompleta", "Servidor não configurado.");
      return;
    }

    if (!/^\d{1,3}$/.test(loginLimpo)) {
      Alert.alert("Login inválido", "Digite um login numérico de 1 a 3 dígitos.");
      return;
    }

    if (!senha) {
      Alert.alert("Senha obrigatória", "Digite sua senha.");
      return;
    }

    try {
      setEntrando(true);

      const resposta = await fetch(`${BACKEND_URL}/auth/login-motorista`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          login: loginLimpo,
          senha,
        }),
      });

      const dados = await resposta.json();

      if (!resposta.ok || !dados.ok) {
        Alert.alert("Não foi possível entrar", dados.mensagem || "Login ou senha inválidos.");
        return;
      }

      motoristaLogadoRef.current = dados.motorista;
      tokenSessaoRef.current = dados.tokenSessao;

      setMotoristaLogado(dados.motorista);
      setTokenSessao(dados.tokenSessao);
      setSenha("");
     } catch (error) {
  Alert.alert(
    "Erro de conexão",
    `Servidor: ${BACKEND_URL}\nErro: ${error.message}`
  );
}
     finally {
      setEntrando(false);
    }
  }

  async function sairDaConta(forcar = false) {
    desejaFicarOnlineRef.current = false;

    if (online && !forcar) {
      Alert.alert("Atenção", "Fique offline antes de sair da conta.");
      return;
    }

    if (socketRef.current) {
      socketRef.current.emit("motorista_offline");
    }

    await pararMonitoramentoLocalizacao();

    onlineRef.current = false;
    motoristaLogadoRef.current = null;
    tokenSessaoRef.current = null;

    setOnline(false);
    setLocalizacao(null);
    setChamadaAtual(null);
    setCorridaAceita(false);
    setModoLocalizacao("economico");
    setMotoristaLogado(null);
    setTokenSessao(null);
    setSenha("");
  }

  async function pegarLocalizacao() {
    try {
      setCarregando(true);

      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        Alert.alert("Permissão negada", "Não foi possível acessar a localização.");
        setCarregando(false);
        return null;
      }

      const posicao = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords = {
        latitude: posicao.coords.latitude,
        longitude: posicao.coords.longitude,
        accuracy: posicao.coords.accuracy,
      };

      setLocalizacao(coords);
      setCarregando(false);
      return coords;
    } catch (error) {
      setCarregando(false);
      Alert.alert("Erro", "Erro ao pegar localização: " + error.message);
      return null;
    }
  }

  async function pararMonitoramentoLocalizacao() {
    if (locationWatcherRef.current) {
      locationWatcherRef.current.remove();
      locationWatcherRef.current = null;
    }
  }

  async function iniciarMonitoramentoLocalizacao(modo = "economico") {
    await pararMonitoramentoLocalizacao();

    setModoLocalizacao(modo);

    const configuracao =
      modo === "alta_precisao"
        ? {
            accuracy: Location.Accuracy.High,
            timeInterval: 10000,
            distanceInterval: 30,
          }
        : {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 30000,
            distanceInterval: 100,
          };

    const watcher = await Location.watchPositionAsync(configuracao, (posicao) => {
      const coords = {
        latitude: posicao.coords.latitude,
        longitude: posicao.coords.longitude,
        accuracy: posicao.coords.accuracy,
        modoLocalizacao: modo,
      };

      setLocalizacao(coords);

      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit("atualizar_localizacao", coords);
      }
    });

    locationWatcherRef.current = watcher;
  }

  async function restaurarOnlineAutomaticamente() {
    if (restaurandoOnlineRef.current) {
      return;
    }

    if (
      !desejaFicarOnlineRef.current ||
      !motoristaLogadoRef.current ||
      !tokenSessaoRef.current ||
      !socketRef.current ||
      !socketRef.current.connected
    ) {
      return;
    }

    try {
      restaurandoOnlineRef.current = true;
      setCarregando(true);

      if (!expoPushTokenRef.current) {
        await configurarNotificacoesPush();
      }

      if (!fcmTokenRef.current) {
        await configurarFcmDireto();
      }

      const coords = await pegarLocalizacao();

      if (!coords) {
        return;
      }

      socketRef.current.emit(
        "motorista_online",
        {
          tokenSessao: tokenSessaoRef.current,
          latitude: coords.latitude,
          longitude: coords.longitude,
          expoPushToken: expoPushTokenRef.current,
          fcmToken: fcmTokenRef.current,
        },
        async (resposta) => {
          if (!resposta || !resposta.ok) {
            desejaFicarOnlineRef.current = false;
            onlineRef.current = false;
            setOnline(false);

            Alert.alert(
              "Não foi possível reconectar",
              resposta?.mensagem || "Faça login novamente."
            );

            await sairDaConta(true);
            return;
          }

          await iniciarMonitoramentoLocalizacao("economico");

          onlineRef.current = true;
          setOnline(true);
        }
      );
    } catch (error) {
      console.log("Erro ao restaurar motorista online:", error.message);
    } finally {
      restaurandoOnlineRef.current = false;
      setCarregando(false);
    }
  }

  async function ficarOnlineOffline() {
    if (!motoristaLogado || !tokenSessao) {
      Alert.alert("Login obrigatório", "Entre na sua conta antes de ficar online.");
      return;
    }

    if (!conectado) {
      Alert.alert("Sem conexão", "O app ainda não conectou ao backend.");
      return;
    }

    if (!online) {
      desejaFicarOnlineRef.current = true;

      if (!expoPushTokenRef.current) {
        await configurarNotificacoesPush();
      }

      if (!fcmTokenRef.current) {
        await configurarFcmDireto();
      }

      const coords = await pegarLocalizacao();

      if (!coords) {
        desejaFicarOnlineRef.current = false;
        return;
      }

      socketRef.current.emit(
        "motorista_online",
        {
          tokenSessao,
          latitude: coords.latitude,
          longitude: coords.longitude,
          expoPushToken: expoPushTokenRef.current,
          fcmToken: fcmTokenRef.current,
        },
        async (resposta) => {
          if (!resposta || !resposta.ok) {
            desejaFicarOnlineRef.current = false;
            onlineRef.current = false;

            Alert.alert(
              "Não foi possível ficar online",
              resposta?.mensagem || "Faça login novamente."
            );
            await pararMonitoramentoLocalizacao();
            setCarregando(false);
            return;
          }

          await iniciarMonitoramentoLocalizacao("economico");

          onlineRef.current = true;
          setOnline(true);
        }
      );
    } else {
      desejaFicarOnlineRef.current = false;

      socketRef.current.emit("motorista_offline");

      await pararMonitoramentoLocalizacao();

      onlineRef.current = false;
      setOnline(false);
      setLocalizacao(null);
      setChamadaAtual(null);
      setCorridaAceita(false);
      setModoLocalizacao("economico");
    }
  }

  async function aceitarChamada() {
    if (!chamadaAtual) return;
    await aceitarChamadaObjeto(chamadaAtual);
  }

  function recusarChamada() {
    if (!chamadaAtual) return;
    recusarChamadaObjeto(chamadaAtual);
  }

  async function executarFinalizarCorrida() {
    if (!chamadaAtual || !motoristaLogado) return;

    socketRef.current.emit("finalizar_corrida", {
      idChamada: chamadaAtual.idChamada,
      tokenTentativa: chamadaAtual.tokenTentativa,
      idMotorista: motoristaLogado.login,
      nomeMotorista: motoristaLogado.nome,
      endereco: chamadaAtual.endereco,
    });

    await iniciarMonitoramentoLocalizacao("economico");

    setChamadaAtual(null);
    setCorridaAceita(false);
  }

  function finalizarCorrida() {
    if (!chamadaAtual) return;

    Alert.alert(
      "Finalizar corrida",
      "Tem certeza que deseja finalizar esta corrida?",
      [
        {
          text: "Não",
          style: "cancel",
        },
        {
          text: "Sim, finalizar",
          style: "destructive",
          onPress: executarFinalizarCorrida,
        },
      ]
    );
  }

  async function executarCancelarCorrida() {
    if (!chamadaAtual || !corridaAceita || !motoristaLogado) return;

    socketRef.current.emit(
      "cancelar_corrida",
      {
        idChamada: chamadaAtual.idChamada,
        tokenTentativa: chamadaAtual.tokenTentativa,
        idMotorista: motoristaLogado.login,
        nomeMotorista: motoristaLogado.nome,
        endereco: chamadaAtual.endereco,
        origemCancelamento: "motorista",
      },
      async (resposta) => {
        if (!resposta || !resposta.ok) {
          Alert.alert(
            "Não foi possível cancelar",
            resposta?.mensagem || "Essa corrida não está mais disponível."
          );
          return;
        }

        await iniciarMonitoramentoLocalizacao("economico");

        setChamadaAtual(null);
        setCorridaAceita(false);

        Alert.alert("Corrida cancelada", resposta.mensagem || "Corrida cancelada por você.");
      }
    );
  }

  function cancelarCorrida() {
    if (!chamadaAtual || !corridaAceita) return;

    Alert.alert(
      "Cancelar corrida",
      "Tem certeza que deseja cancelar esta corrida?",
      [
        {
          text: "Não",
          style: "cancel",
        },
        {
          text: "Sim, cancelar",
          style: "destructive",
          onPress: executarCancelarCorrida,
        },
      ]
    );
  }

  async function abrirNavegacao() {
    if (!chamadaAtual) {
      Alert.alert("Navegação", "Não há corrida aceita para abrir navegação.");
      return;
    }

    const destinoLat = Number(chamadaAtual.latitudePassageiro);
    const destinoLng = Number(chamadaAtual.longitudePassageiro);

    if (!Number.isFinite(destinoLat) || !Number.isFinite(destinoLng)) {
      Alert.alert(
        "Navegação",
        "Não foi possível encontrar a localização do cliente nesta chamada."
      );
      return;
    }

    const origemLat = Number(localizacao?.latitude);
    const origemLng = Number(localizacao?.longitude);

    const origem =
      Number.isFinite(origemLat) && Number.isFinite(origemLng)
        ? `&origin=${origemLat},${origemLng}`
        : "";

    const url = `https://www.google.com/maps/dir/?api=1${origem}&destination=${destinoLat},${destinoLng}&travelmode=driving`;

    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert(
        "Erro ao abrir navegação",
        "Não foi possível abrir o aplicativo de mapas neste celular."
      );
    }
  }

  if (!motoristaLogado) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <StatusBar barStyle="light-content" />

        <Text style={styles.titulo}>Cornélio Move</Text>
        <Text style={styles.subtitulo}>Login do Mototaxista - V9.1</Text>

        <View style={styles.conexaoLinha}>
          <View style={[styles.bolinhaConexao, conectado ? styles.bolinhaVerde : styles.bolinhaVermelha]} />
          <Text style={styles.conexaoTexto}>
            {conectado ? "Backend conectado" : "Backend desconectado"}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Entre com seu login e senha</Text>

          <TextInput
            style={styles.input}
            placeholder="Login do motorista"
            placeholderTextColor="#9ca3af"
            value={login}
            onChangeText={setLogin}
            keyboardType="numeric"
            maxLength={3}
          />

          <TextInput
            style={styles.input}
            placeholder="Senha"
            placeholderTextColor="#9ca3af"
            value={senha}
            onChangeText={setSenha}
            secureTextEntry
          />

          <TouchableOpacity
            style={styles.botaoVerde}
            onPress={entrarNaConta}
            disabled={entrando}
          >
            <Text style={styles.textoBotao}>{entrando ? "Entrando..." : "Entrar"}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, chamadaAtual && !corridaAceita ? styles.containerChamadaAtiva : null]}>
      <StatusBar barStyle="light-content" />

      <Text style={styles.titulo}>Cornélio Move</Text>
      <Text style={styles.subtitulo}>App do Mototaxista - V9.1</Text>

      <View style={styles.conexaoLinha}>
        <View style={[styles.bolinhaConexao, conectado ? styles.bolinhaVerde : styles.bolinhaVermelha]} />
        <Text style={styles.conexaoTexto}>
          {conectado ? "Backend conectado" : "Backend desconectado"} • {statusFcm}
        </Text>
      </View>

      {chamadaAtual && !corridaAceita && (
        <View style={styles.cardChamadaPrioritaria}>
          <Text style={styles.chamadaTitulo}>Nova chamada</Text>

          <Text style={styles.info}>Cliente: {chamadaAtual.cliente}</Text>
          <Text style={styles.enderecoChamada}>{chamadaAtual.endereco}</Text>
          <View style={styles.linhaResumoChamada}>
            <Text style={styles.resumoChamada}>{chamadaAtual.distancia}</Text>
            <Text style={styles.resumoChamada}>{chamadaAtual.tempo}</Text>
          </View>

          {chamadaAtual.observacao && (
            <Text style={styles.info}>Obs: {chamadaAtual.observacao}</Text>
          )}

          <View style={styles.linhaBotoesChamada}>
            <TouchableOpacity style={styles.botaoRecusarGrande} onPress={recusarChamada}>
              <Text style={styles.textoBotaoGrande}>Recusar</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.botaoAceitarGrande} onPress={aceitarChamada}>
              <Text style={styles.textoBotaoGrande}>Aceitar</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {(!chamadaAtual || corridaAceita) && (
        <View style={styles.cardStatus}>
          <Text style={styles.label}>Status do motorista</Text>

          <Text style={online ? styles.verdeGrande : styles.vermelhoGrande}>
            {online ? "ONLINE" : "OFFLINE"}
          </Text>

          <TouchableOpacity
            style={online ? styles.botaoVermelho : styles.botaoVerde}
            onPress={ficarOnlineOffline}
            disabled={carregando}
          >
            <Text style={styles.textoBotao}>
              {carregando ? "Buscando GPS..." : online ? "Ficar Offline" : "Ficar Online"}
            </Text>
          </TouchableOpacity>

          {online && (
            <Text style={styles.modoTexto}>
              GPS: {modoLocalizacao === "alta_precisao" ? "Alta precisão" : "Econômico"}
            </Text>
          )}

          {localizacao && (
            <View style={styles.caixaLocalizacaoCompacta}>
              <Text style={styles.localizacaoTexto}>
                Precisão GPS: {Math.round(localizacao.accuracy)} m
              </Text>
            </View>
          )}
        </View>
      )}

      {!chamadaAtual && (
        <View style={styles.cardAguardando}>
          <Text style={styles.aguardandoTitulo}>Aguardando chamada</Text>
          <Text style={styles.aguardandoTexto}>
            Quando o painel despachar uma corrida, ela aparecerá aqui.
          </Text>
        </View>
      )}

      {chamadaAtual && corridaAceita && (
        <View style={styles.cardAceita}>
          <Text style={styles.chamadaTitulo}>Corrida aceita</Text>
          <Text style={styles.info}>Vá até:</Text>
          <Text style={styles.endereco}>{chamadaAtual.endereco}</Text>

          <TouchableOpacity style={styles.botaoAzul} onPress={abrirNavegacao}>
            <Text style={styles.textoBotao}>Abrir navegação</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.botaoCancelar} onPress={cancelarCorrida}>
            <Text style={styles.textoBotao}>Cancelar corrida</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.botaoPreto} onPress={finalizarCorrida}>
            <Text style={styles.textoBotao}>Finalizar corrida</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.cardConta}>
        <Text style={styles.label}>Conta do motorista</Text>
        <Text style={styles.contaTexto}>
          {motoristaLogado.login} - {motoristaLogado.nome}
        </Text>

        <TouchableOpacity style={styles.botaoCinza} onPress={() => sairDaConta(false)}>
          <Text style={styles.textoBotao}>Sair da conta</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#111827",
    padding: 18,
    paddingTop: 34,
    justifyContent: "flex-start",
  },
  containerChamadaAtiva: {
    paddingTop: 24,
  },
  titulo: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "bold",
    textAlign: "center",
  },
  subtitulo: {
    color: "#cbd5e1",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 8,
  },
  conexaoLinha: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  bolinhaConexao: {
    width: 11,
    height: 11,
    borderRadius: 999,
    marginRight: 8,
  },
  bolinhaVerde: {
    backgroundColor: "#22c55e",
  },
  bolinhaVermelha: {
    backgroundColor: "#ef4444",
  },
  conexaoTexto: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "bold",
  },
  card: {
    backgroundColor: "#1f2937",
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
  },
  cardStatus: {
    backgroundColor: "#1f2937",
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
  },
  cardConta: {
    backgroundColor: "#1f2937",
    borderRadius: 16,
    padding: 18,
    marginTop: 14,
    marginBottom: 16,
  },
  label: {
    color: "#94a3b8",
    textAlign: "center",
    fontSize: 14,
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#111827",
    color: "#ffffff",
    padding: 14,
    borderRadius: 10,
    marginTop: 10,
    marginBottom: 10,
    fontSize: 16,
  },
  contaTexto: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 14,
  },
  verdeGrande: {
    color: "#22c55e",
    fontSize: 34,
    fontWeight: "bold",
    textAlign: "center",
    marginVertical: 10,
  },
  vermelhoGrande: {
    color: "#ef4444",
    fontSize: 34,
    fontWeight: "bold",
    textAlign: "center",
    marginVertical: 10,
  },
  verdePequeno: {
    color: "#22c55e",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
    marginTop: 8,
  },
  vermelhoPequeno: {
    color: "#ef4444",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
    marginTop: 8,
  },
  url: {
    color: "#cbd5e1",
    textAlign: "center",
    fontSize: 12,
    marginTop: 6,
  },
  botaoVerde: {
    backgroundColor: "#22c55e",
    padding: 16,
    borderRadius: 12,
  },
  botaoVermelho: {
    backgroundColor: "#ef4444",
    padding: 16,
    borderRadius: 12,
  },
  botaoCinza: {
    backgroundColor: "#4b5563",
    padding: 14,
    borderRadius: 12,
  },
  textoBotao: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "bold",
    fontSize: 16,
  },
  modoTexto: {
    color: "#facc15",
    textAlign: "center",
    fontSize: 14,
    fontWeight: "bold",
    marginTop: 12,
  },
  caixaLocalizacaoCompacta: {
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 10,
    marginTop: 12,
  },
  caixaLocalizacao: {
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  localizacaoTexto: {
    color: "#cbd5e1",
    textAlign: "center",
    marginTop: 4,
  },
  cardAguardando: {
    backgroundColor: "#374151",
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
  },
  aguardandoTitulo: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
  },
  aguardandoTexto: {
    color: "#cbd5e1",
    textAlign: "center",
    marginTop: 8,
  },
  cardChamadaPrioritaria: {
    backgroundColor: "#facc15",
    borderRadius: 18,
    padding: 18,
    marginTop: 4,
    marginBottom: 14,
  },
  enderecoChamada: {
    color: "#111827",
    fontSize: 19,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 10,
  },
  linhaResumoChamada: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 8,
  },
  resumoChamada: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "bold",
    marginHorizontal: 10,
  },
  linhaBotoesChamada: {
    flexDirection: "row",
    marginTop: 12,
  },
  botaoAceitarGrande: {
    backgroundColor: "#16a34a",
    paddingVertical: 18,
    borderRadius: 14,
    flex: 1,
    marginLeft: 7,
  },
  botaoRecusarGrande: {
    backgroundColor: "#dc2626",
    paddingVertical: 18,
    borderRadius: 14,
    flex: 1,
    marginRight: 7,
  },
  textoBotaoGrande: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "bold",
    fontSize: 18,
  },
  cardChamada: {
    backgroundColor: "#facc15",
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
  },
  cardAceita: {
    backgroundColor: "#e5e7eb",
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
  },
  chamadaTitulo: {
    color: "#111827",
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 14,
  },
  info: {
    color: "#111827",
    fontSize: 16,
    marginBottom: 8,
  },
  endereco: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 18,
  },
  linhaBotoes: {
    flexDirection: "row",
    marginTop: 14,
  },
  botaoAceitar: {
    backgroundColor: "#16a34a",
    padding: 18,
    borderRadius: 12,
    flex: 1,
    marginLeft: 6,
  },
  botaoRecusar: {
    backgroundColor: "#dc2626",
    padding: 18,
    borderRadius: 12,
    flex: 1,
    marginRight: 6,
  },
  botaoAzul: {
    backgroundColor: "#2563eb",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  botaoCancelar: {
    backgroundColor: "#dc2626",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  botaoPreto: {
    backgroundColor: "#111827",
    padding: 16,
    borderRadius: 12,
  },
});