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
import * as TaskManager from "expo-task-manager";
import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import notifee, { AndroidImportance } from "@notifee/react-native";
import messaging from "@react-native-firebase/messaging";
import { io } from "socket.io-client";

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || "http://207.180.245.177:3001").replace(/\/$/, "");
const CATEGORIA_CORRIDA = "corrida";
const CANAL_CORRIDAS = "corridas";
const CANAL_CORRIDAS_URGENTES = "corridas-urgentes";
const STORAGE_MOTORISTA = "cornelio_move_motorista_sessao_v1";

const TASK_LOCALIZACAO_BACKGROUND = "cornelio_move_motorista_background_location";

function configuracaoLocalizacaoPorModo(modo = "economico") {
  return modo === "alta_precisao"
    ? {
        accuracy: Location.Accuracy.High,
        timeInterval: 2500,
        distanceInterval: 5,
      }
    : {
        accuracy: Location.Accuracy.High,
        timeInterval: 8000,
        distanceInterval: 20,
      };
}

async function enviarLocalizacaoMotoristaPorHttp(coords = {}, origem = "background") {
  try {
    if (!BACKEND_URL) {
      return;
    }

    const latitude = Number(coords.latitude);
    const longitude = Number(coords.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    const bruto = await SecureStore.getItemAsync(STORAGE_MOTORISTA);

    if (!bruto) {
      return;
    }

    const sessao = JSON.parse(bruto);
    const desejaOnline = Boolean(sessao?.desejaOnline);
    const login = String(sessao?.login || sessao?.motorista?.login || "").trim();
    const tokenSessao = String(sessao?.tokenSessao || "").trim();

    if (!desejaOnline || !login || !tokenSessao) {
      return;
    }

    await fetch(`${BACKEND_URL}/motorista/nativo/localizacao`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        login,
        idMotorista: login,
        tokenSessao,
        latitude,
        longitude,
        accuracy: coords.accuracy || "",
        modoLocalizacao: origem,
        expoPushToken: sessao?.expoPushToken || "",
        fcmToken: sessao?.fcmToken || "",
      }),
    }).catch((error) => {
      console.log("Falha HTTP ao enviar localizacao do motorista:", error.message);
    });
  } catch (error) {
    console.log("Erro ao enviar localizacao background:", error.message);
  }
}

TaskManager.defineTask(TASK_LOCALIZACAO_BACKGROUND, async ({ data, error }) => {
  if (error) {
    console.log("Erro na tarefa de localizacao background:", error.message);
    return;
  }

  const locations = data?.locations || [];
  const ultima = locations[locations.length - 1];

  if (!ultima?.coords) {
    return;
  }

  await enviarLocalizacaoMotoristaPorHttp(
    {
      latitude: ultima.coords.latitude,
      longitude: ultima.coords.longitude,
      accuracy: ultima.coords.accuracy,
    },
    "background"
  );
});

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
  const buscandoChamadaPendenteRef = useRef(false);
  const chamadaAtualRef = useRef(null);

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
  const [statusPush, setStatusPush] = useState("Configurando notificacÃµes...");
  const [statusFcm, setStatusFcm] = useState("");
  const [restaurandoSessao, setRestaurandoSessao] = useState(true);

  async function configurarNotificacoesPush() {
    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync(CANAL_CORRIDAS, {
          name: "Corridas",
          importance: Notifications.AndroidImportance.MAX,
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
        setStatusPush("Notificacoes bloqueadas no celular");
        return null;
      }

      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;

      if (!projectId) {
        expoPushTokenRef.current = null;
        setStatusPush("Sem projectId do EAS");
        console.log("Project ID do EAS nao encontrado no app.");
        return null;
      }

      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      expoPushTokenRef.current = token;
      setStatusPush("Notificacoes ativas");
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
        setStatusFcm("FCM nao autorizado");
        return null;
      }

      const token = await messaging().getToken();

      fcmTokenRef.current = token;
      setStatusFcm("");
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
        endereco: dados.endereco || "Endereco nao informado",
        observacao: dados.observacao || "",
        latitudePassageiro: dados.latitudePassageiro,
        longitudePassageiro: dados.longitudePassageiro,
        distancia: dados.distancia || "Distancia a calcular",
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
      console.log("Nao foi possivel remover notificacao da corrida:", error.message);
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


  async function limparNotificacoesDaCorrida() {
    try {
      await notifee.cancelAllNotifications();
    } catch (error) {
      console.log("Falha ao limpar notificacoes Notifee:", error.message);
    }

    try {
      await Notifications.dismissAllNotificationsAsync();
    } catch (error) {
      console.log("Falha ao limpar notificacoes Expo:", error.message);
    }
  }

  function normalizarChamadaBackend(chamada = {}) {
    return {
      idChamada: String(chamada.idChamada || ""),
      tokenTentativa: String(chamada.tokenTentativa || ""),
      cliente: String(chamada.cliente || "Cliente"),
      endereco: String(chamada.endereco || "Endereco nao informado"),
      observacao: String(chamada.observacao || ""),
      latitudePassageiro: chamada.latitudePassageiro,
      longitudePassageiro: chamada.longitudePassageiro,
      distancia: String(chamada.distancia || ""),
      tempo: String(chamada.tempo || ""),
      origem: String(chamada.origem || "Despacho"),
    };
  }

  async function buscarChamadaPendenteNoBackend(motivo = "manual") {
    const motoristaAtual = motoristaLogadoRef.current;

    if (
      !BACKEND_URL ||
      !motoristaAtual?.login ||
      buscandoChamadaPendenteRef.current
    ) {
      return;
    }

    try {
      buscandoChamadaPendenteRef.current = true;

      const url = `${BACKEND_URL}/motorista/chamada-pendente/${encodeURIComponent(
        motoristaAtual.login
      )}?t=${Date.now()}`;

      const resposta = await fetch(url);
      const dados = await resposta.json().catch(() => null);

      console.log("Busca de chamada pendente:", motivo, dados);

      if (!resposta.ok || !dados?.ok || !dados.temChamada || !dados.chamada) {
        return;
      }

      const chamada = normalizarChamadaBackend(dados.chamada);

      if (!chamada.idChamada || !chamada.tokenTentativa) {
        console.log("Chamada pendente sem id/token:", chamada);
        return;
      }

      await limparNotificacoesDaCorrida();

      setChamadaAtual(chamada);
      setCorridaAceita(false);
    } catch (error) {
      console.log("Erro ao buscar chamada pendente:", error.message);
    } finally {
      buscandoChamadaPendenteRef.current = false;
    }
  }

  function obterChamadaDaNotificacao(response) {
    const dados = response?.notification?.request?.content?.data || {};
    return dados.chamada || null;
  }

  async function aceitarChamadaObjeto(chamada) {
    const motoristaAtual = motoristaLogadoRef.current;

    if (!chamada || !motoristaAtual || !socketRef.current || !socketRef.current.connected) {
      Alert.alert(
        "Nao foi possivel aceitar",
        "Abra o app, confirme a conexao e tente novamente."
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
            "Chamada indisponivel",
            resposta?.mensagem || "Essa chamada nao esta mais disponivel."
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


  async function salvarSessaoMotorista(opcoes = {}) {
    try {
      const motoristaAtual = opcoes.motorista || motoristaLogadoRef.current || motoristaLogado;
      const tokenAtual = opcoes.tokenSessao || tokenSessaoRef.current || tokenSessao;
      const loginAtual = String(opcoes.login || motoristaAtual?.login || login || "").trim();
      const senhaAtual = String(
        Object.prototype.hasOwnProperty.call(opcoes, "senha") ? opcoes.senha : senha
      );
      const expoPushTokenAtual = Object.prototype.hasOwnProperty.call(opcoes, "expoPushToken")
        ? opcoes.expoPushToken
        : expoPushTokenRef.current;
      const fcmTokenAtual = Object.prototype.hasOwnProperty.call(opcoes, "fcmToken")
        ? opcoes.fcmToken
        : fcmTokenRef.current;

      if (!loginAtual || !senhaAtual) {
        return;
      }

      const payload = {
        login: loginAtual,
        senha: senhaAtual,
        motorista: motoristaAtual || null,
        tokenSessao: tokenAtual || null,
        expoPushToken: expoPushTokenAtual || null,
        fcmToken: fcmTokenAtual || null,
        desejaOnline: Boolean(
          Object.prototype.hasOwnProperty.call(opcoes, "desejaOnline")
            ? opcoes.desejaOnline
            : desejaFicarOnlineRef.current
        ),
        salvoEm: new Date().toISOString(),
      };

      await SecureStore.setItemAsync(STORAGE_MOTORISTA, JSON.stringify(payload));
    } catch (error) {
      console.log("Erro ao salvar sessao do motorista:", error.message);
    }
  }

  async function limparSessaoMotoristaSalva() {
    try {
      await SecureStore.deleteItemAsync(STORAGE_MOTORISTA);
    } catch (error) {
      console.log("Erro ao limpar sessao do motorista:", error.message);
    }
  }

  async function loginMotoristaComCredenciaisSalvas(loginSalvo, senhaSalva, motivo = "auto") {
    const loginLimpo = String(loginSalvo || "").trim();
    const senhaLimpa = String(senhaSalva || "");

    if (!loginLimpo || !senhaLimpa) {
      return null;
    }

    const resposta = await fetch(BACKEND_URL + "/auth/login-motorista", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        login: loginLimpo,
        senha: senhaLimpa,
      }),
    });

    const dados = await resposta.json().catch(() => null);

    if (!resposta.ok || !dados?.ok) {
      throw new Error(dados?.mensagem || "Nao foi possivel restaurar login do motorista.");
    }

    motoristaLogadoRef.current = dados.motorista;
    tokenSessaoRef.current = dados.tokenSessao;

    setLogin(loginLimpo);
    setMotoristaLogado(dados.motorista);
    setTokenSessao(dados.tokenSessao);

    await salvarSessaoMotorista({
      login: loginLimpo,
      senha: senhaLimpa,
      motorista: dados.motorista,
      tokenSessao: dados.tokenSessao,
    });

    console.log("Login do motorista restaurado:", motivo);

    return dados;
  }

  async function restaurarSessaoMotoristaSalva(motivo = "abertura_app") {
    if (!BACKEND_URL) {
      setRestaurandoSessao(false);
      return;
    }

    try {
      setRestaurandoSessao(true);

      const bruto = await SecureStore.getItemAsync(STORAGE_MOTORISTA);

      if (!bruto) {
        return;
      }

      const sessao = JSON.parse(bruto);
      const loginSalvo = String(sessao.login || "").trim();
      const senhaSalva = String(sessao.senha || "");

      if (!loginSalvo || !senhaSalva) {
        await limparSessaoMotoristaSalva();
        return;
      }

      setLogin(loginSalvo);

      await loginMotoristaComCredenciaisSalvas(loginSalvo, senhaSalva, motivo);

      if (sessao.desejaOnline) {
        desejaFicarOnlineRef.current = true;

        setTimeout(() => {
          restaurarOnlineAutomaticamente();
        }, 500);
      }
    } catch (error) {
      console.log("Nao foi possivel restaurar sessao do motorista:", error.message);
    } finally {
      setRestaurandoSessao(false);
    }
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
    restaurarSessaoMotoristaSalva("inicio_app");
  }, []);

  useEffect(() => {
    configurarNotificacoesPush();
    configurarFcmDireto();

    // Corridas sao exibidas e controladas exclusivamente pela Activity Android nativa.
    // O React mantem apenas login, conexao, GPS e renovacao do token FCM.
    const unsubscribeToken = messaging().onTokenRefresh((novoToken) => {
      fcmTokenRef.current = novoToken;
      setStatusFcm("");

      salvarSessaoMotorista({ fcmToken: novoToken }).catch((error) => {
        console.log("Nao foi possivel salvar FCM atualizado:", error.message);
      });

      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit("atualizar_fcm_token", {
          fcmToken: novoToken,
        });
      }
    });

    return () => {
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
        "Configuracao incompleta",
        "Conexao do aplicativo nao configurada."
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
      console.log("Sessao do motorista invalida, tentando relogar automaticamente:", dados?.mensagem);
      await sairDaConta(true, false);
      await restaurarSessaoMotoristaSalva("auth_erro");
    });

    socketRef.current.on("nova_chamada", (chamada) => {
      console.log(
        "Nova chamada recebida via Socket.IO ignorada no React. Fluxo nativo/FCM assume:",
        chamada?.idChamada
      );
    });

    const limparChamadaNormalDoReact = (dados = {}) => {
      const idChamada = String(dados.idChamada || "");

      if (!idChamada) {
        return;
      }

      setChamadaAtual((atual) => {
        if (atual && String(atual.idChamada) === idChamada) {
          return null;
        }

        return atual;
      });

      setCorridaAceita(false);
    };

    socketRef.current.on("chamada_aceita", limparChamadaNormalDoReact);
    socketRef.current.on("chamada_recusada", limparChamadaNormalDoReact);
    socketRef.current.on("corrida_finalizada", limparChamadaNormalDoReact);
    socketRef.current.on("corrida_cancelada", limparChamadaNormalDoReact);

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
          Alert.alert("Chamada indisponivel", dados.mensagem);
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
      Alert.alert("Configuracao incompleta", "Conexao do aplicativo nao configurada.");
      return;
    }

    if (!/^\d{1,3}$/.test(loginLimpo)) {
      Alert.alert("Login invalido", "Digite um login numerico de 1 a 3 digitos.");
      return;
    }

    if (!senha) {
      Alert.alert("Senha obrigatoria", "Digite sua senha.");
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
        Alert.alert("Nao foi possivel entrar", dados.mensagem || "Login ou senha invalidos.");
        return;
      }

      motoristaLogadoRef.current = dados.motorista;
      tokenSessaoRef.current = dados.tokenSessao;

      setMotoristaLogado(dados.motorista);
      setTokenSessao(dados.tokenSessao);
      await salvarSessaoMotorista({
        login: loginLimpo,
        senha,
        motorista: dados.motorista,
        tokenSessao: dados.tokenSessao,
        desejaOnline: desejaFicarOnlineRef.current,
      });
      setSenha("");
     } catch (error) {
  Alert.alert(
    "Erro de conexao",
    `Erro: ${error.message}`
  );
}
     finally {
      setEntrando(false);
    }
  }

  async function sairDaConta(forcar = false, limparSessaoSalva = true) {
    desejaFicarOnlineRef.current = false;

    if (online && !forcar) {
      Alert.alert("Atencao", "Fique offline antes de sair da conta.");
      return;
    }

    if (socketRef.current) {
      socketRef.current.emit("motorista_offline");
    }

    await pararMonitoramentoLocalizacao();

    onlineRef.current = false;
    motoristaLogadoRef.current = null;
    tokenSessaoRef.current = null;

    if (limparSessaoSalva) {
      await limparSessaoMotoristaSalva();
    }

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
        Alert.alert("Permissao negada", "Nao foi possivel acessar a localizacao.");
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
      Alert.alert("Erro", "Erro ao pegar localizacao: " + error.message);
      return null;
    }
  }

  async function pararLocalizacaoBackground() {
    try {
      const ativa = await Location.hasStartedLocationUpdatesAsync(TASK_LOCALIZACAO_BACKGROUND);

      if (ativa) {
        await Location.stopLocationUpdatesAsync(TASK_LOCALIZACAO_BACKGROUND);
      }
    } catch (error) {
      console.log("Nao foi possivel parar localizacao background:", error.message);
    }
  }

  async function garantirPermissaoLocalizacaoBackground() {
    try {
      const permissaoForegroundAtual = await Location.getForegroundPermissionsAsync();
      let statusForeground = permissaoForegroundAtual.status;

      if (statusForeground !== "granted") {
        const novaPermissaoForeground = await Location.requestForegroundPermissionsAsync();
        statusForeground = novaPermissaoForeground.status;
      }

      if (statusForeground !== "granted") {
        Alert.alert("Permissao negada", "Nao foi possivel acessar a localizacao.");
        return false;
      }

      if (Platform.OS !== "android") {
        return true;
      }

      const permissaoBackgroundAtual = await Location.getBackgroundPermissionsAsync();

      if (permissaoBackgroundAtual.status === "granted") {
        return true;
      }

      Alert.alert(
        "Localizacao em segundo plano",
        "Para o cliente acompanhar o mototaxista com a tela bloqueada, permita a localizacao o tempo todo nas proximas telas."
      );

      const novaPermissaoBackground = await Location.requestBackgroundPermissionsAsync();

      if (novaPermissaoBackground.status !== "granted") {
        Alert.alert(
          "Localizacao limitada",
          "Sem a permissao 'Permitir o tempo todo', a localizacao pode parar quando o app ficar em segundo plano."
        );
        return false;
      }

      return true;
    } catch (error) {
      console.log("Erro ao pedir permissao background:", error.message);
      return false;
    }
  }

  async function iniciarLocalizacaoBackground(modo = "economico") {
    try {
      const permitido = await garantirPermissaoLocalizacaoBackground();

      if (!permitido) {
        return;
      }

      const jaAtiva = await Location.hasStartedLocationUpdatesAsync(TASK_LOCALIZACAO_BACKGROUND);

      if (jaAtiva) {
        await Location.stopLocationUpdatesAsync(TASK_LOCALIZACAO_BACKGROUND);
      }

      await Location.startLocationUpdatesAsync(TASK_LOCALIZACAO_BACKGROUND, {
        ...configuracaoLocalizacaoPorModo(modo),
        foregroundService: {
          notificationTitle: "Cornelio Move Motorista",
          notificationBody:
            modo === "alta_precisao"
              ? "Corrida em andamento: enviando localizacao em tempo real."
              : "Voce esta online: enviando localizacao quando possivel.",
          notificationColor: "#2563eb",
          killServiceOnDestroy: false,
        },
      });
    } catch (error) {
      console.log("Nao foi possivel iniciar localizacao background:", error.message);
      Alert.alert(
        "Localizacao em segundo plano",
        "Nao foi possivel ativar a localizacao com tela bloqueada: " + error.message
      );
    }
  }

  async function pararMonitoramentoLocalizacao() {
    if (locationWatcherRef.current) {
      locationWatcherRef.current.remove();
      locationWatcherRef.current = null;
    }

    await pararLocalizacaoBackground();
  }

  async function iniciarMonitoramentoLocalizacao(modo = "economico") {
    await pararMonitoramentoLocalizacao();

    setModoLocalizacao(modo);

    const configuracao = configuracaoLocalizacaoPorModo(modo);

    const watcher = await Location.watchPositionAsync(configuracao, async (posicao) => {
      const coords = {
        latitude: posicao.coords.latitude,
        longitude: posicao.coords.longitude,
        accuracy: posicao.coords.accuracy,
        modoLocalizacao: modo,
      };

      setLocalizacao(coords);

      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit("atualizar_localizacao", coords);
      } else {
        await enviarLocalizacaoMotoristaPorHttp(coords, "foreground_sem_socket");
      }
    });

    locationWatcherRef.current = watcher;

    await iniciarLocalizacaoBackground(modo);
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
              "Nao foi possivel reconectar",
              resposta?.mensagem || "Faca login novamente."
            );

            await sairDaConta(true);
            return;
          }

          await iniciarMonitoramentoLocalizacao("economico");

          onlineRef.current = true;
          setOnline(true);
          await salvarSessaoMotorista({ desejaOnline: true });
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
      Alert.alert("Login obrigatorio", "Entre na sua conta antes de ficar online.");
      return;
    }

    if (!conectado) {
      Alert.alert("Sem conexao", "O app ainda nao conectou.");
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
              "Nao foi possivel ficar online",
              resposta?.mensagem || "Faca login novamente."
            );
            await pararMonitoramentoLocalizacao();
            setCarregando(false);
            return;
          }

          if (resposta.corridaAtiva) {
            console.log(
              "Corrida aberta recuperada pelo backend; a interface permanece na Activity Android nativa:",
              resposta.corridaAtiva.idChamada
            );
            await iniciarMonitoramentoLocalizacao("alta_precisao");
          } else {
            await iniciarMonitoramentoLocalizacao("economico");
          }

          // Nunca recria card de corrida dentro do React.
          setChamadaAtual(null);
          setCorridaAceita(false);

          onlineRef.current = true;
          setOnline(true);
          await salvarSessaoMotorista({ desejaOnline: true });
        }
      );
    } else {
      desejaFicarOnlineRef.current = false;

      socketRef.current.emit("motorista_offline");

      await pararMonitoramentoLocalizacao();

      onlineRef.current = false;
      setOnline(false);
      setLocalizacao(null);

      // A corrida nunca e renderizada pelo React; a Activity nativa consulta o backend.
      setChamadaAtual(null);
      setCorridaAceita(false);

      setModoLocalizacao("economico");
      await salvarSessaoMotorista({ desejaOnline: false });
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
          text: "Nao",
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
            "Nao foi possivel cancelar",
            resposta?.mensagem || "Essa corrida nao esta mais disponivel."
          );
          return;
        }

        await iniciarMonitoramentoLocalizacao("economico");

        setChamadaAtual(null);
        setCorridaAceita(false);

        Alert.alert("Corrida cancelada", resposta.mensagem || "Corrida cancelada por voce.");
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
          text: "Nao",
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
      Alert.alert("Navegacao", "Nao ha corrida aceita para abrir navegacao.");
      return;
    }

    const destinoLat = Number(chamadaAtual.latitudePassageiro);
    const destinoLng = Number(chamadaAtual.longitudePassageiro);

    if (!Number.isFinite(destinoLat) || !Number.isFinite(destinoLng)) {
      Alert.alert(
        "Navegacao",
        "Nao foi possivel encontrar a localizacao do cliente nesta chamada."
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
        "Erro ao abrir navegacao",
        "Nao foi possivel abrir o aplicativo de mapas neste celular."
      );
    }
  }

  if (restaurandoSessao && !motoristaLogado) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.titulo}>Cornelio Move</Text>
        <Text style={styles.subtitulo}>Restaurando sessao do motorista...</Text>
      </View>
    );
  }

  if (!motoristaLogado) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <StatusBar barStyle="light-content" />

        <Text style={styles.titulo}>Cornelio Move</Text>
        <Text style={styles.subtitulo}>Login do Mototaxista - V9.1</Text>

        <View style={styles.conexaoLinha}>
          <View style={[styles.bolinhaConexao, conectado ? styles.bolinhaVerde : styles.bolinhaVermelha]} />
          <Text style={styles.conexaoTexto}>
            {conectado ? "Conectado" : "Desconectado"}
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
    <ScrollView contentContainerStyle={styles.container}>
      <StatusBar barStyle="light-content" />

      <Text style={styles.titulo}>Cornelio Move</Text>
      <Text style={styles.subtitulo}>App do Mototaxista - V11.1</Text>

      <View style={styles.conexaoLinha}>
        <View style={[styles.bolinhaConexao, conectado ? styles.bolinhaVerde : styles.bolinhaVermelha]} />
        <Text style={styles.conexaoTexto}>
          {conectado ? "Conectado" : "Desconectado"}
        </Text>
      </View>

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
            GPS: {modoLocalizacao === "alta_precisao" ? "Alta precisao" : "Economico"}
          </Text>
        )}
      </View>

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







