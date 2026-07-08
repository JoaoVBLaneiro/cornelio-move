import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as Location from "expo-location";
import { io } from "socket.io-client";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function App() {
  const socketRef = useRef(null);
  const locationWatcherRef = useRef(null);

  const [conectado, setConectado] = useState(false);
  const [online, setOnline] = useState(false);
  const [localizacao, setLocalizacao] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [chamadaAtual, setChamadaAtual] = useState(null);
  const [corridaAceita, setCorridaAceita] = useState(false);
  const [modoLocalizacao, setModoLocalizacao] = useState("economico");

  const [idMotorista, setIdMotorista] = useState("41");
  const [nomeMotorista, setNomeMotorista] = useState("Motorista Teste 41");

  useEffect(() => {
    socketRef.current = io(BACKEND_URL, {
      transports: ["websocket"],
      reconnection: true,
    });

    socketRef.current.on("connect", () => {
      setConectado(true);
      console.log("Conectado ao backend:", socketRef.current.id);
    });

    socketRef.current.on("disconnect", () => {
      setConectado(false);
      console.log("Desconectado do backend");
    });

    socketRef.current.on("nova_chamada", (chamada) => {
      setChamadaAtual(chamada);
      setCorridaAceita(false);
      Alert.alert("Nova chamada", chamada.endereco);
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

      if (socketRef.current) {
        socketRef.current.emit("atualizar_localizacao", coords);
      }
    });

    locationWatcherRef.current = watcher;
  }

  async function ficarOnlineOffline() {
    if (!conectado) {
      Alert.alert("Sem conexão", "O app ainda não conectou ao backend.");
      return;
    }

    if (!idMotorista.trim()) {
      Alert.alert("Atenção", "Digite o número/login do motorista.");
      return;
    }

    if (!nomeMotorista.trim()) {
      Alert.alert("Atenção", "Digite o nome do motorista.");
      return;
    }

    if (!online) {
      const coords = await pegarLocalizacao();

      if (!coords) return;

      socketRef.current.emit("motorista_online", {
        idMotorista: idMotorista.trim(),
        nome: nomeMotorista.trim(),
        latitude: coords.latitude,
        longitude: coords.longitude,
      });

      await iniciarMonitoramentoLocalizacao("economico");

      setOnline(true);
    } else {
      socketRef.current.emit("motorista_offline");

      await pararMonitoramentoLocalizacao();

      setOnline(false);
      setLocalizacao(null);
      setChamadaAtual(null);
      setCorridaAceita(false);
      setModoLocalizacao("economico");
    }
  }

  async function aceitarChamada() {
    if (!chamadaAtual) return;

    socketRef.current.emit(
      "aceitar_chamada",
      {
        idChamada: chamadaAtual.idChamada,
        tokenTentativa: chamadaAtual.tokenTentativa,
        idMotorista: idMotorista.trim(),
        nomeMotorista: nomeMotorista.trim(),
        endereco: chamadaAtual.endereco,
      },
      async (resposta) => {
        if (!resposta || !resposta.ok) {
          Alert.alert(
            "Chamada indisponível",
            resposta?.mensagem || "Essa chamada não está mais disponível."
          );

          setChamadaAtual(null);
          setCorridaAceita(false);

          if (online) {
            await iniciarMonitoramentoLocalizacao("economico");
          }

          return;
        }

        await iniciarMonitoramentoLocalizacao("alta_precisao");

        setCorridaAceita(true);
      }
    );
  }

  function recusarChamada() {
    if (!chamadaAtual) return;

    socketRef.current.emit("recusar_chamada", {
      idChamada: chamadaAtual.idChamada,
      tokenTentativa: chamadaAtual.tokenTentativa,
      idMotorista: idMotorista.trim(),
      nomeMotorista: nomeMotorista.trim(),
      endereco: chamadaAtual.endereco,
    });

    setChamadaAtual(null);
    setCorridaAceita(false);
  }

  async function executarFinalizarCorrida() {
    if (!chamadaAtual) return;

    socketRef.current.emit("finalizar_corrida", {
      idChamada: chamadaAtual.idChamada,
      tokenTentativa: chamadaAtual.tokenTentativa,
      idMotorista: idMotorista.trim(),
      nomeMotorista: nomeMotorista.trim(),
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
    if (!chamadaAtual || !corridaAceita) return;

    socketRef.current.emit(
      "cancelar_corrida",
      {
        idChamada: chamadaAtual.idChamada,
        tokenTentativa: chamadaAtual.tokenTentativa,
        idMotorista: idMotorista.trim(),
        nomeMotorista: nomeMotorista.trim(),
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <StatusBar barStyle="light-content" />

      <Text style={styles.titulo}>Cornélio Move</Text>
      <Text style={styles.subtitulo}>App do Mototaxista</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Conexão com backend</Text>
        <Text style={conectado ? styles.verdePequeno : styles.vermelhoPequeno}>
          {conectado ? "CONECTADO" : "DESCONECTADO"}
        </Text>
        <Text style={styles.url}>Servidor Configurado</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Identificação do motorista</Text>

        <TextInput
          style={styles.input}
          placeholder="Número/Login do motorista"
          placeholderTextColor="#9ca3af"
          value={idMotorista}
          onChangeText={setIdMotorista}
          editable={!online}
          keyboardType="numeric"
        />

        <TextInput
          style={styles.input}
          placeholder="Nome do motorista"
          placeholderTextColor="#9ca3af"
          value={nomeMotorista}
          onChangeText={setNomeMotorista}
          editable={!online}
        />
      </View>

      <View style={styles.card}>
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
            Modo GPS: {modoLocalizacao === "alta_precisao" ? "Alta precisão" : "Econômico"}
          </Text>
        )}

        {localizacao && (
          <View style={styles.caixaLocalizacao}>
            <Text style={styles.localizacaoTexto}>
              Lat: {localizacao.latitude.toFixed(6)}
            </Text>
            <Text style={styles.localizacaoTexto}>
              Lng: {localizacao.longitude.toFixed(6)}
            </Text>
            <Text style={styles.localizacaoTexto}>
              Precisão: {Math.round(localizacao.accuracy)} m
            </Text>
          </View>
        )}
      </View>

      {!chamadaAtual && (
        <View style={styles.cardAguardando}>
          <Text style={styles.aguardandoTitulo}>Aguardando chamada</Text>
          <Text style={styles.aguardandoTexto}>
            Quando o painel ou passageiro despachar uma corrida, ela aparecerá aqui.
          </Text>
        </View>
      )}

      {chamadaAtual && !corridaAceita && (
        <View style={styles.cardChamada}>
          <Text style={styles.chamadaTitulo}>Nova chamada</Text>

          <Text style={styles.info}>Cliente: {chamadaAtual.cliente}</Text>
          <Text style={styles.info}>Embarque: {chamadaAtual.endereco}</Text>
          <Text style={styles.info}>Distância: {chamadaAtual.distancia}</Text>
          <Text style={styles.info}>Tempo: {chamadaAtual.tempo}</Text>
          <Text style={styles.info}>Origem: {chamadaAtual.origem}</Text>

          {chamadaAtual.observacao && (
            <Text style={styles.info}>Obs: {chamadaAtual.observacao}</Text>
          )}

          <View style={styles.linhaBotoes}>
            <TouchableOpacity style={styles.botaoAceitar} onPress={aceitarChamada}>
              <Text style={styles.textoBotao}>Aceitar</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.botaoRecusar} onPress={recusarChamada}>
              <Text style={styles.textoBotao}>Recusar</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {chamadaAtual && corridaAceita && (
        <View style={styles.cardAceita}>
          <Text style={styles.chamadaTitulo}>Corrida aceita</Text>
          <Text style={styles.info}>Vá até:</Text>
          <Text style={styles.endereco}>{chamadaAtual.endereco}</Text>

          <TouchableOpacity
            style={styles.botaoAzul}
            onPress={() => Alert.alert("Navegação", "Depois vamos abrir Google Maps/Waze aqui.")}
          >
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#111827",
    padding: 20,
    justifyContent: "center",
  },
  titulo: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "bold",
    textAlign: "center",
  },
  subtitulo: {
    color: "#cbd5e1",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 24,
  },
  card: {
    backgroundColor: "#1f2937",
    borderRadius: 16,
    padding: 18,
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
    fontSize: 16,
  },
  verdeGrande: {
    color: "#22c55e",
    fontSize: 34,
    fontWeight: "bold",
    textAlign: "center",
    marginVertical: 14,
  },
  vermelhoGrande: {
    color: "#ef4444",
    fontSize: 34,
    fontWeight: "bold",
    textAlign: "center",
    marginVertical: 14,
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
  textoBotao: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "bold",
    fontSize: 16,
  },
  modoTexto: {
    color: "#facc15",
    textAlign: "center",
    fontSize: 15,
    fontWeight: "bold",
    marginTop: 14,
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
  cardChamada: {
    backgroundColor: "#facc15",
    borderRadius: 16,
    padding: 20,
  },
  cardAceita: {
    backgroundColor: "#e5e7eb",
    borderRadius: 16,
    padding: 20,
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
    padding: 16,
    borderRadius: 12,
    flex: 1,
    marginRight: 6,
  },
  botaoRecusar: {
    backgroundColor: "#dc2626",
    padding: 16,
    borderRadius: 12,
    flex: 1,
    marginLeft: 6,
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