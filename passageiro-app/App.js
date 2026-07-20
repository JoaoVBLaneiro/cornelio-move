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
import * as SecureStore from "expo-secure-store";
import { io } from "socket.io-client";

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || "http://207.180.245.177:3001").replace(/\/$/, "");
const STORAGE_PASSAGEIRO = "cornelio_move_passageiro_sessao_v1";

function normalizarCelular(valor) {
  return String(valor || "").replace(/\D/g, "");
}

export default function App() {
  const socketRef = useRef(null);
  const passageiroRef = useRef(null);
  const tokenSessaoRef = useRef(null);
  const restaurandoAuthRef = useRef(false);

  const [conectado, setConectado] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [status, setStatus] = useState("Faca login para chamar um mototaxi.");
  const [localizacao, setLocalizacao] = useState(null);
  const [motoristaAceitou, setMotoristaAceitou] = useState(null);
  const [chamadaAtual, setChamadaAtual] = useState(null);

  const [modoAuth, setModoAuth] = useState("login");
  const [passageiro, setPassageiro] = useState(null);
  const [tokenSessao, setTokenSessao] = useState(null);

  const [nome, setNome] = useState("");
  const [celular, setCelular] = useState("");
  const [senha, setSenha] = useState("");
  const [authCarregando, setAuthCarregando] = useState(false);
  const [restaurandoSessao, setRestaurandoSessao] = useState(true);


  async function salvarSessaoPassageiro(opcoes = {}) {
    try {
      const celularAtual = String(opcoes.celular || celular || passageiroRef.current?.celular || "").replace(/\D/g, "");
      const senhaAtual = String(
        Object.prototype.hasOwnProperty.call(opcoes, "senha") ? opcoes.senha : senha
      );
      const passageiroAtual = opcoes.passageiro || passageiroRef.current || passageiro;
      const tokenAtual = opcoes.tokenSessao || tokenSessaoRef.current || tokenSessao;

      if (!celularAtual || !senhaAtual) {
        return;
      }

      await SecureStore.setItemAsync(
        STORAGE_PASSAGEIRO,
        JSON.stringify({
          celular: celularAtual,
          senha: senhaAtual,
          passageiro: passageiroAtual || null,
          tokenSessao: tokenAtual || null,
          salvoEm: new Date().toISOString(),
        })
      );
    } catch (error) {
      console.log("Erro ao salvar sessao do passageiro:", error.message);
    }
  }

  async function limparSessaoPassageiroSalva() {
    try {
      await SecureStore.deleteItemAsync(STORAGE_PASSAGEIRO);
    } catch (error) {
      console.log("Erro ao limpar sessao do passageiro:", error.message);
    }
  }

  async function loginPassageiroComCredenciaisSalvas(celularSalvo, senhaSalva, motivo = "auto") {
    const celularLimpo = normalizarCelular(celularSalvo);
    const senhaLimpa = String(senhaSalva || "");

    if (!celularLimpo || !senhaLimpa) {
      return null;
    }

    const resposta = await fetch(BACKEND_URL + "/auth/login-passageiro", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        celular: celularLimpo,
        senha: senhaLimpa,
      }),
    });

    const dados = await resposta.json().catch(() => null);

    if (!resposta.ok || !dados?.ok) {
      throw new Error(dados?.mensagem || "Nao foi possivel restaurar login do passageiro.");
    }

    passageiroRef.current = dados.passageiro;
    tokenSessaoRef.current = dados.tokenSessao;

    setCelular(celularLimpo);
    setPassageiro(dados.passageiro);
    setTokenSessao(dados.tokenSessao);
    setStatus("Pronto. Voce ja pode chamar um mototaxi.");

    await salvarSessaoPassageiro({
      celular: celularLimpo,
      senha: senhaLimpa,
      passageiro: dados.passageiro,
      tokenSessao: dados.tokenSessao,
    });

    console.log("Login do passageiro restaurado:", motivo);

    return dados;
  }

  async function restaurarSessaoPassageiroSalva(motivo = "abertura_app") {
    if (restaurandoAuthRef.current) {
      return;
    }

    try {
      restaurandoAuthRef.current = true;
      setRestaurandoSessao(true);

      const bruto = await SecureStore.getItemAsync(STORAGE_PASSAGEIRO);

      if (!bruto) {
        return;
      }

      const sessao = JSON.parse(bruto);
      const celularSalvo = normalizarCelular(sessao.celular);
      const senhaSalva = String(sessao.senha || "");

      if (!celularSalvo || !senhaSalva) {
        await limparSessaoPassageiroSalva();
        return;
      }

      setCelular(celularSalvo);

      await loginPassageiroComCredenciaisSalvas(celularSalvo, senhaSalva, motivo);
    } catch (error) {
      console.log("Nao foi possivel restaurar sessao do passageiro:", error.message);
    } finally {
      restaurandoAuthRef.current = false;
      setRestaurandoSessao(false);
    }
  }

  useEffect(() => {
    passageiroRef.current = passageiro;
  }, [passageiro]);

  useEffect(() => {
    tokenSessaoRef.current = tokenSessao;
  }, [tokenSessao]);

  useEffect(() => {
    restaurarSessaoPassageiroSalva("inicio_app");
  }, []);

  useEffect(() => {
    if (!passageiro || !tokenSessao) {
      return;
    }

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

    socketRef.current.on("status_chamada", async (dados) => {
      setStatus(dados.mensagem || "Atualizacao da chamada.");

      if (
        dados.status === "sem_motoristas" ||
        dados.status === "ninguem_atendeu" ||
        dados.status === "auth_erro"
      ) {
        setBuscando(false);
        setMotoristaAceitou(null);
        setChamadaAtual(null);

        if (dados.status === "auth_erro") {
          console.log("Sessao do passageiro invalida, tentando relogar automaticamente:", dados?.mensagem);
          await sairDaConta(false);
          await restaurarSessaoPassageiroSalva("auth_erro");
        }
      }
    });

    socketRef.current.on("chamada_aceita_passageiro", (dados) => {
      setMotoristaAceitou(dados.nomeMotorista);
      setChamadaAtual({
        idChamada: dados.idChamada,
        nomeMotorista: dados.nomeMotorista,
      });
      setStatus(dados.mensagem || `${dados.nomeMotorista} aceitou sua chamada.`);
      setBuscando(false);
    });

    socketRef.current.on("corrida_finalizada_passageiro", (dados) => {
      setStatus(dados.mensagem || "Corrida finalizada.");
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
        socketRef.current = null;
      }
    };
  }, [passageiro, tokenSessao]);

  async function enviarAuth(tipo) {
    const celularLimpo = normalizarCelular(celular);
    const nomeLimpo = nome.trim();
    const senhaLimpa = senha;

    if (tipo === "cadastro" && nomeLimpo.length < 2) {
      Alert.alert("Atencao", "Informe seu nome.");
      return;
    }

    if (celularLimpo.length < 10 || celularLimpo.length > 11) {
      Alert.alert("Atencao", "Informe o celular com DDD. Ex: 43999999999");
      return;
    }

    if (senhaLimpa.length < 4) {
      Alert.alert("Atencao", "A senha deve ter pelo menos 4 caracteres.");
      return;
    }

    try {
      setAuthCarregando(true);

      const rota =
        tipo === "cadastro"
          ? "/auth/cadastro-passageiro"
          : "/auth/login-passageiro";

      const resposta = await fetch(`${BACKEND_URL}${rota}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nome: nomeLimpo,
          celular: celularLimpo,
          senha: senhaLimpa,
        }),
      });

      const dados = await resposta.json().catch(() => null);

      if (!resposta.ok || !dados?.ok) {
        Alert.alert(
          tipo === "cadastro" ? "Nao foi possivel cadastrar" : "Nao foi possivel entrar",
          dados?.mensagem || "Tente novamente."
        );
        return;
      }

      passageiroRef.current = dados.passageiro;
      tokenSessaoRef.current = dados.tokenSessao;
      setPassageiro(dados.passageiro);
      setTokenSessao(dados.tokenSessao);
      setStatus("Pronto. Voce ja pode chamar um mototaxi.");
      await salvarSessaoPassageiro({
        celular: celularLimpo,
        senha: senhaLimpa,
        passageiro: dados.passageiro,
        tokenSessao: dados.tokenSessao,
      });
      setSenha("");
    } catch (error) {
      Alert.alert("Erro", "Falha de conexao: " + error.message);
    } finally {
      setAuthCarregando(false);
    }
  }

  async function sairDaConta(limparSessaoSalva = true) {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (limparSessaoSalva) {
      await limparSessaoPassageiroSalva();
    }

    setConectado(false);
    setBuscando(false);
    setStatus("Faca login para chamar um mototaxi.");
    setLocalizacao(null);
    setMotoristaAceitou(null);
    setChamadaAtual(null);
    passageiroRef.current = null;
    tokenSessaoRef.current = null;
    setPassageiro(null);
    setTokenSessao(null);
  }

  async function pegarLocalizacao() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        Alert.alert("Permissao negada", "Nao foi possivel acessar sua localizacao.");
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
      Alert.alert("Erro", "Erro ao pegar localizacao: " + error.message);
      return null;
    }
  }

  async function chamarMototaxi() {
    if (!passageiro || !tokenSessao) {
      Alert.alert("Login necessario", "Entre na sua conta para chamar um mototaxi.");
      return;
    }

    if (!conectado || !socketRef.current) {
      Alert.alert("Sem conexao", "O app ainda nao conectou ao servidor.");
      return;
    }

    setMotoristaAceitou(null);
    setChamadaAtual(null);
    setBuscando(true);
    setStatus("Pegando sua localizacao...");

    const coords = await pegarLocalizacao();

    if (!coords) {
      setBuscando(false);
      setStatus("Nao foi possivel pegar sua localizacao.");
      return;
    }

    setStatus("Buscando mototaxista proximo...");

    socketRef.current.emit("passageiro_chamar", {
      tokenSessaoPassageiro: tokenSessao,
      passageiro: {
        idPassageiro: passageiro.idPassageiro,
        nome: passageiro.nome,
        celular: passageiro.celular,
      },
      nome: passageiro.nome,
      celular: passageiro.celular,
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
    });
  }

  function executarCancelarCorrida() {
    if (!chamadaAtual || !chamadaAtual.idChamada) {
      Alert.alert("Atencao", "Nao ha corrida aceita para cancelar.");
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
            "Nao foi possivel cancelar",
            resposta?.mensagem || "Essa corrida nao esta mais disponivel."
          );
          return;
        }

        setStatus(resposta.mensagem || "Corrida cancelada por voce.");
        setBuscando(false);
        setMotoristaAceitou(null);
        setChamadaAtual(null);
        Alert.alert("Corrida cancelada", resposta.mensagem || "Corrida cancelada por voce.");
      }
    );
  }

  function cancelarCorrida() {
    if (!chamadaAtual || !chamadaAtual.idChamada) {
      Alert.alert("Atencao", "Nao ha corrida aceita para cancelar.");
      return;
    }

    Alert.alert("Cancelar corrida", "Tem certeza que deseja cancelar esta corrida?", [
      {
        text: "Nao",
        style: "cancel",
      },
      {
        text: "Sim, cancelar",
        style: "destructive",
        onPress: executarCancelarCorrida,
      },
    ]);
  }

  if (restaurandoSessao && !passageiro) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.titulo}>Cornelio Move</Text>
        <Text style={styles.subtitulo}>Restaurando sessao do passageiro...</Text>
      </ScrollView>
    );
  }

  if (!passageiro) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <StatusBar barStyle="light-content" />

        <Text style={styles.titulo}>Cornelio Move</Text>
        <Text style={styles.subtitulo}>App do Passageiro</Text>

        <View style={styles.cardPrincipal}>
          <Text style={styles.tituloCard}>
            {modoAuth === "login" ? "Entrar" : "Criar conta"}
          </Text>

          {modoAuth === "cadastro" && (
            <TextInput
              style={styles.input}
              placeholder="Nome"
              placeholderTextColor="#9ca3af"
              value={nome}
              onChangeText={setNome}
            />
          )}

          <TextInput
            style={styles.input}
            placeholder="Celular com DDD"
            placeholderTextColor="#9ca3af"
            value={celular}
            onChangeText={setCelular}
            keyboardType="phone-pad"
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
            style={styles.botaoChamar}
            onPress={() => enviarAuth(modoAuth === "login" ? "login" : "cadastro")}
            disabled={authCarregando}
          >
            <Text style={styles.textoBotao}>
              {authCarregando
                ? "AGUARDE..."
                : modoAuth === "login"
                ? "ENTRAR"
                : "CRIAR CONTA"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.botaoLink}
            onPress={() => setModoAuth(modoAuth === "login" ? "cadastro" : "login")}
          >
            <Text style={styles.textoLink}>
              {modoAuth === "login"
                ? "Ainda nao tenho conta"
                : "Ja tenho conta"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <StatusBar barStyle="light-content" />

      <Text style={styles.titulo}>Cornelio Move</Text>
      <Text style={styles.subtitulo}>App do Passageiro</Text>

      <View style={styles.cardConexao}>
        <Text style={styles.label}>Conta</Text>
        <Text style={styles.nomePassageiro}>{passageiro.nome}</Text>
        <Text style={styles.celularPassageiro}>{passageiro.celular}</Text>

        <TouchableOpacity style={styles.botaoSair} onPress={sairDaConta}>
          <Text style={styles.textoBotaoSair}>Sair da conta</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.cardConexao}>
        <Text style={styles.label}>Conexao</Text>
        <Text style={conectado ? styles.conectado : styles.desconectado}>
          {conectado ? "CONECTADO" : "DESCONECTADO"}
        </Text>
      </View>

      <View style={styles.cardPrincipal}>
        <Text style={styles.textoInstrucao}>
          Aperte o botao abaixo e o app vai chamar o mototaxista mais proximo da sua localizacao.
        </Text>

        <TouchableOpacity
          style={buscando ? styles.botaoBuscando : styles.botaoChamar}
          onPress={chamarMototaxi}
          disabled={buscando}
        >
          <Text style={styles.textoBotao}>
            {buscando ? "BUSCANDO..." : "CHAMAR MOTOTAXI"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.cardStatus}>
        <Text style={styles.label}>Status da chamada</Text>
        <Text style={styles.status}>{status}</Text>

        {motoristaAceitou && (
          <>
            <Text style={styles.motorista}>Mototaxista: {motoristaAceitou}</Text>

            <TouchableOpacity style={styles.botaoCancelar} onPress={cancelarCorrida}>
              <Text style={styles.textoBotaoCancelar}>Cancelar corrida</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {localizacao && (
        <View style={styles.cardLocalizacao}>
          <Text style={styles.label}>Sua localizacao</Text>
          <Text style={styles.localizacaoTexto}>
            Lat: {localizacao.latitude.toFixed(6)}
          </Text>
          <Text style={styles.localizacaoTexto}>
            Lng: {localizacao.longitude.toFixed(6)}
          </Text>
          <Text style={styles.localizacaoTexto}>
            Precisao: {Math.round(localizacao.accuracy)} m
          </Text>
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
  tituloCard: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 16,
  },
  input: {
    backgroundColor: "#111827",
    color: "#ffffff",
    borderRadius: 12,
    padding: 16,
    fontSize: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#374151",
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
  nomePassageiro: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
  },
  celularPassageiro: {
    color: "#cbd5e1",
    fontSize: 16,
    textAlign: "center",
    marginTop: 4,
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
  botaoLink: {
    padding: 16,
    marginTop: 12,
  },
  textoLink: {
    color: "#60a5fa",
    fontSize: 17,
    textAlign: "center",
    fontWeight: "bold",
  },
  textoBotao: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  },
  botaoSair: {
    backgroundColor: "#4b5563",
    padding: 12,
    borderRadius: 12,
    marginTop: 14,
  },
  textoBotaoSair: {
    color: "#ffffff",
    fontSize: 15,
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