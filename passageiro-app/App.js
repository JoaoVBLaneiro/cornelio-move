import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Location from "expo-location";
import { io } from "socket.io-client";

const BACKEND_URL = "http://192.168.0.123:3001";

export default function App() {
  const socketRef = useRef(null);

  const [conectado, setConectado] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [status, setStatus] = useState("Aguardando você chamar um mototáxi.");
  const [localizacao, setLocalizacao] = useState(null);
  const [motoristaAceitou, setMotoristaAceitou] = useState(null);
  const [chamadaAtual, setChamadaAtual] = useState(null);

  useEffect(() => {
    socketRef.current = io(BACKEND_URL, {
      transports: ["websocket"],
      reconnection: true,
    });

    socketRef.current.on("connect", () => {
      setConectado(true);
      console.log("Passageiro conectado:", socketRef.current.id);
    });

    socketRef.current.on("disconnect", () => {
      setConectado(false);
      console.log("Passageiro desconectado");
    });

  socketRef.current.on("status_chamada", (dados) => {
  setStatus(dados.mensagem);

  if (
    dados.status === "sem_motoristas" ||
    dados.status === "ninguem_atendeu"
  ) {
    setBuscando(false);
    setMotoristaAceitou(null);
    setChamadaAtual(null);
  }
});
    socketRef.current.on("chamada_aceita_passageiro", (dados) => {
      setMotoristaAceitou(dados.nomeMotorista);
      setChamadaAtual({
        idChamada: dados.idChamada,
        nomeMotorista: dados.nomeMotorista,
      });
      setStatus(dados.mensagem);
      setBuscando(false);
    });

    socketRef.current.on("corrida_finalizada_passageiro", (dados) => {
      setStatus(dados.mensagem);
      setBuscando(false);
      setMotoristaAceitou(null);
      setChamadaAtual(null);
    });

    socketRef.current.on("corrida_cancelada_passageiro", (dados) => {
      setStatus(dados.mensagem || "Corrida cancelada.");
      setBuscando(false);
      setMotoristaAceitou(null);
      setChamadaAtual(null);
      Alert.alert("Corrida cancelada", dados.mensagem || "Corrida cancelada.");
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  async function pegarLocalizacao() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        Alert.alert("Permissão negada", "Não foi possível acessar sua localização.");
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
      return coords;
    } catch (error) {
      Alert.alert("Erro", "Erro ao pegar localização: " + error.message);
      return null;
    }
  }

  async function chamarMototaxi() {
    if (!conectado) {
      Alert.alert("Sem conexão", "O app ainda não conectou ao servidor.");
      return;
    }

    setMotoristaAceitou(null);
    setChamadaAtual(null);
    setBuscando(true);
    setStatus("Pegando sua localização...");

    const coords = await pegarLocalizacao();

    if (!coords) {
      setBuscando(false);
      setStatus("Não foi possível pegar sua localização.");
      return;
    }

    setStatus("Buscando mototaxista próximo...");

    socketRef.current.emit("passageiro_chamar", {
      nome: "Passageiro teste",
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
    });
  }

  function executarCancelarCorrida() {
    if (!chamadaAtual || !chamadaAtual.idChamada) {
      Alert.alert("Atenção", "Não há corrida aceita para cancelar.");
      return;
    }

    socketRef.current.emit(
      "cancelar_corrida",
      {
        idChamada: chamadaAtual.idChamada,
        origemCancelamento: "passageiro",
      },
      (resposta) => {
        if (!resposta || !resposta.ok) {
          Alert.alert(
            "Não foi possível cancelar",
            resposta?.mensagem || "Essa corrida não está mais disponível."
          );
          return;
        }

        setStatus(resposta.mensagem || "Corrida cancelada por você.");
        setBuscando(false);
        setMotoristaAceitou(null);
        setChamadaAtual(null);
        Alert.alert("Corrida cancelada", resposta.mensagem || "Corrida cancelada por você.");
      }
    );
  }

  function cancelarCorrida() {
    if (!chamadaAtual || !chamadaAtual.idChamada) {
      Alert.alert("Atenção", "Não há corrida aceita para cancelar.");
      return;
    }

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
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <Text style={styles.titulo}>Cornélio Move</Text>
      <Text style={styles.subtitulo}>App do Passageiro</Text>

      <View style={styles.cardConexao}>
        <Text style={styles.label}>Conexão</Text>
        <Text style={conectado ? styles.conectado : styles.desconectado}>
          {conectado ? "CONECTADO" : "DESCONECTADO"}
        </Text>
      </View>

      <View style={styles.cardPrincipal}>
        <Text style={styles.textoInstrucao}>
          Aperte o botão abaixo e o app vai chamar o mototaxista mais próximo da sua localização.
        </Text>

        <TouchableOpacity
          style={buscando ? styles.botaoBuscando : styles.botaoChamar}
          onPress={chamarMototaxi}
          disabled={buscando}
        >
          <Text style={styles.textoBotao}>
            {buscando ? "BUSCANDO..." : "CHAMAR MOTOTÁXI"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.cardStatus}>
        <Text style={styles.label}>Status da chamada</Text>
        <Text style={styles.status}>{status}</Text>

        {motoristaAceitou && (
          <>
            <Text style={styles.motorista}>
              Mototaxista: {motoristaAceitou}
            </Text>

            <TouchableOpacity style={styles.botaoCancelar} onPress={cancelarCorrida}>
              <Text style={styles.textoBotaoCancelar}>Cancelar corrida</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {localizacao && (
        <View style={styles.cardLocalizacao}>
          <Text style={styles.label}>Sua localização</Text>
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111827",
    padding: 20,
    justifyContent: "center",
  },
  titulo: {
    color: "#ffffff",
    fontSize: 34,
    fontWeight: "bold",
    textAlign: "center",
  },
  subtitulo: {
    color: "#cbd5e1",
    fontSize: 17,
    textAlign: "center",
    marginBottom: 24,
  },
  cardConexao: {
    backgroundColor: "#1f2937",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  cardPrincipal: {
    backgroundColor: "#1f2937",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  cardStatus: {
    backgroundColor: "#374151",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  cardLocalizacao: {
    backgroundColor: "#1f2937",
    borderRadius: 16,
    padding: 16,
  },
  label: {
    color: "#94a3b8",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 8,
  },
  conectado: {
    color: "#22c55e",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  },
  desconectado: {
    color: "#ef4444",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  },
  textoInstrucao: {
    color: "#e5e7eb",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 22,
  },
  botaoChamar: {
    backgroundColor: "#22c55e",
    padding: 22,
    borderRadius: 16,
  },
  botaoBuscando: {
    backgroundColor: "#facc15",
    padding: 22,
    borderRadius: 16,
  },
  textoBotao: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  },
  status: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
    lineHeight: 28,
  },
  motorista: {
    color: "#22c55e",
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
    marginTop: 14,
  },
  botaoCancelar: {
    backgroundColor: "#dc2626",
    padding: 16,
    borderRadius: 12,
    marginTop: 16,
  },
  textoBotaoCancelar: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
  },
  localizacaoTexto: {
    color: "#cbd5e1",
    textAlign: "center",
    marginTop: 4,
  },
});