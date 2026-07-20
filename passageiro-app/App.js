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
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { io } from "socket.io-client";

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || "http://207.180.245.177:3001").replace(/\/$/, "");
const STORAGE_PASSAGEIRO = "cornelio_move_passageiro_sessao_v1";

function coordenadaValida(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && Math.abs(numero) > 0.000001;
}

function montarPontoMapa(origem) {
  if (!origem) {
    return null;
  }

  const latitude = Number(origem.latitude);
  const longitude = Number(origem.longitude);

  if (!coordenadaValida(latitude) || !coordenadaValida(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    accuracy: origem.accuracy ? Number(origem.accuracy) : null,
  };
}

function gerarMapaHtmlPassageiro(localizacao, motoristaMapa, nomeMotorista) {
  const passageiro = montarPontoMapa(localizacao);
  const motorista = montarPontoMapa(motoristaMapa);
  const centro = passageiro || motorista || { latitude: -23.1813, longitude: -50.6460 };

  const dados = JSON.stringify({
    centro,
    passageiro,
    motorista,
    nomeMotorista: nomeMotorista || motoristaMapa?.nomeMotorista || "Mototaxista",
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map {
      height: 100%;
      width: 100%;
      margin: 0;
      padding: 0;
      background: #dbe4e8;
      overflow: hidden;
      font-family: Arial, sans-serif;
    }
    .leaflet-control-attribution { display: none; }
    .rotulo {
      border: 0;
      border-radius: 999px;
      background: rgba(17, 24, 39, 0.88);
      color: #fff;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: bold;
      box-shadow: 0 6px 14px rgba(0,0,0,0.18);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const dados = ${dados};
    const map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      tap: true
    }).setView([dados.centro.latitude, dados.centro.longitude], dados.passageiro ? 16 : 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);

    const pontos = [];

    if (dados.passageiro) {
      const p = [dados.passageiro.latitude, dados.passageiro.longitude];
      pontos.push(p);
      L.circleMarker(p, {
        radius: 9,
        color: '#0f172a',
        weight: 3,
        fillColor: '#22c55e',
        fillOpacity: 1
      }).addTo(map).bindTooltip('Voce', { permanent: true, direction: 'top', className: 'rotulo' });

      if (dados.passageiro.accuracy) {
        L.circle(p, {
          radius: Math.max(10, Math.min(Number(dados.passageiro.accuracy), 120)),
          color: '#22c55e',
          weight: 1,
          fillColor: '#22c55e',
          fillOpacity: 0.08
        }).addTo(map);
      }
    }

    if (dados.motorista) {
      const m = [dados.motorista.latitude, dados.motorista.longitude];
      pontos.push(m);
      L.circleMarker(m, {
        radius: 10,
        color: '#0f172a',
        weight: 3,
        fillColor: '#facc15',
        fillOpacity: 1
      }).addTo(map).bindTooltip(dados.nomeMotorista || 'Mototaxista', { permanent: true, direction: 'top', className: 'rotulo' });
    }

    if (pontos.length >= 2) {
      L.polyline(pontos, { color: '#111827', weight: 4, opacity: 0.65, dashArray: '8, 8' }).addTo(map);
      map.fitBounds(pontos, { padding: [70, 70], maxZoom: 17 });
    }
  </script>
</body>
</html>`;
}

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
  const [menuAberto, setMenuAberto] = useState(false);
  const [motoristaMapa, setMotoristaMapa] = useState(null);


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
        setMotoristaMapa(null);

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
        idMotorista: dados.idMotorista,
      });
      setStatus(dados.mensagem || `${dados.nomeMotorista} aceitou sua chamada.`);
      setBuscando(false);
    });

    socketRef.current.on("motorista_localizacao_passageiro", (dados) => {
      setChamadaAtual((atual) => {
        if (!atual || String(atual.idChamada) !== String(dados.idChamada || atual.idChamada)) {
          return atual;
        }

        setMotoristaMapa({
          idMotorista: dados.idMotorista || atual.idMotorista,
          nomeMotorista: dados.nomeMotorista || atual.nomeMotorista || motoristaAceitou || "Mototaxista",
          latitude: dados.latitude,
          longitude: dados.longitude,
          accuracy: dados.accuracy,
        });

        return atual;
      });
    });

    socketRef.current.on("corrida_finalizada_passageiro", (dados) => {
      setStatus(dados.mensagem || "Corrida finalizada.");
      setBuscando(false);
      setMotoristaAceitou(null);
      setChamadaAtual(null);
      setMotoristaMapa(null);
    });

    socketRef.current.on("corrida_cancelada_passageiro", (dados) => {
      setStatus(dados.mensagem || "Corrida cancelada.");
      setBuscando(false);
      setMotoristaAceitou(null);
      setChamadaAtual(null);
      setMotoristaMapa(null);
      Alert.alert("Corrida cancelada", dados.mensagem || "Corrida cancelada.");
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [passageiro, tokenSessao]);

  useEffect(() => {
    if (!chamadaAtual || !chamadaAtual.idChamada) {
      setMotoristaMapa(null);
      return;
    }

    let ativo = true;

    async function buscarMotoristaDaCorrida() {
      try {
        const resposta = await fetch(BACKEND_URL + "/admin/corridas-ativas");
        const dados = await resposta.json().catch(() => null);

        if (!ativo || !dados?.ok || !Array.isArray(dados.corridas)) {
          return;
        }

        const corrida = dados.corridas.find((item) =>
          String(item.idChamada) === String(chamadaAtual.idChamada)
        );

        const motorista = corrida?.motorista;

        if (!motorista) {
          return;
        }

        const latitude = Number(motorista.latitude);
        const longitude = Number(motorista.longitude);

        if (!coordenadaValida(latitude) || !coordenadaValida(longitude)) {
          return;
        }

        setMotoristaMapa({
          idMotorista: motorista.idMotorista || chamadaAtual.idMotorista,
          nomeMotorista: motorista.nomeMotorista || chamadaAtual.nomeMotorista || motoristaAceitou || "Mototaxista",
          latitude,
          longitude,
          online: motorista.online,
          statusOperacional: motorista.statusOperacional,
        });
      } catch (error) {
        console.log("Erro ao buscar motorista no mapa:", error.message);
      }
    }

    buscarMotoristaDaCorrida();

    const intervalo = setInterval(buscarMotoristaDaCorrida, 4000);

    return () => {
      ativo = false;
      clearInterval(intervalo);
    };
  }, [chamadaAtual?.idChamada, motoristaAceitou]);

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
    setMotoristaMapa(null);
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

  const mapaHtml = gerarMapaHtmlPassageiro(localizacao, motoristaMapa, motoristaAceitou);
  const chaveMapa = [
    localizacao?.latitude,
    localizacao?.longitude,
    motoristaMapa?.latitude,
    motoristaMapa?.longitude,
    chamadaAtual?.idChamada || "sem-corrida",
  ].join("-");

  return (
    <View style={styles.telaMapa}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      <WebView
        key={chaveMapa}
        originWhitelist={["*"]}
        source={{ html: mapaHtml }}
        style={styles.mapaWebView}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      />

      <TouchableOpacity style={styles.botaoMenuMapa} onPress={() => setMenuAberto((valor) => !valor)}>
        <Text style={styles.textoMenuMapa}>☰</Text>
      </TouchableOpacity>

      {menuAberto && (
        <View style={styles.menuFlutuante}>
          <Text style={styles.menuTitulo}>{passageiro.nome}</Text>
          <Text style={styles.menuSubtitulo}>{passageiro.celular}</Text>
          <TouchableOpacity
            style={styles.botaoSairMenu}
            onPress={() => {
              setMenuAberto(false);
              sairDaConta();
            }}
          >
            <Text style={styles.textoBotaoSairMenu}>Sair da conta</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.painelInferiorMapa}>
        <Text style={styles.nomeAppMapa}>Cornelio Move</Text>
        <Text style={styles.statusMapa}>{status}</Text>

        {motoristaAceitou && (
          <View style={styles.caixaMotoristaMapa}>
            <Text style={styles.labelMotoristaMapa}>Mototaxista</Text>
            <Text style={styles.nomeMotoristaMapa}>{motoristaAceitou}</Text>
            <Text style={styles.infoMotoristaMapa}>
              {motoristaMapa ? "Localizacao do mototaxista no mapa" : "Aguardando localizacao do mototaxista..."}
            </Text>
          </View>
        )}

        {!motoristaAceitou && (
          <TouchableOpacity
            style={buscando ? styles.botaoBuscandoMapa : styles.botaoChamarMapa}
            onPress={chamarMototaxi}
            disabled={buscando}
          >
            <Text style={styles.textoBotaoMapa}>
              {buscando ? "BUSCANDO..." : "CHAMAR MOTOTAXI"}
            </Text>
          </TouchableOpacity>
        )}

        {motoristaAceitou && (
          <TouchableOpacity style={styles.botaoCancelarMapa} onPress={cancelarCorrida}>
            <Text style={styles.textoBotaoCancelarMapa}>Cancelar corrida</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
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
  cardPrincipal: {
    backgroundColor: "#1f2937",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
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
  botaoChamar: {
    backgroundColor: "#22c55e",
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
  telaMapa: {
    flex: 1,
    backgroundColor: "#dbe4e8",
  },
  mapaWebView: {
    flex: 1,
    backgroundColor: "#dbe4e8",
  },
  botaoMenuMapa: {
    position: "absolute",
    top: 44,
    right: 20,
    width: 58,
    height: 50,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  textoMenuMapa: {
    color: "#111827",
    fontSize: 34,
    fontWeight: "bold",
    marginTop: -4,
  },
  menuFlutuante: {
    position: "absolute",
    top: 102,
    right: 20,
    width: 230,
    backgroundColor: "rgba(17,24,39,0.96)",
    borderRadius: 20,
    padding: 16,
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  menuTitulo: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "bold",
  },
  menuSubtitulo: {
    color: "#cbd5e1",
    fontSize: 14,
    marginTop: 3,
    marginBottom: 14,
  },
  botaoSairMenu: {
    backgroundColor: "#4b5563",
    borderRadius: 12,
    padding: 12,
  },
  textoBotaoSairMenu: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "bold",
    textAlign: "center",
  },
  painelInferiorMapa: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 22,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 28,
    padding: 18,
    elevation: 12,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
  },
  nomeAppMapa: {
    color: "#111827",
    fontSize: 23,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 6,
  },
  statusMapa: {
    color: "#4b5563",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 14,
  },
  botaoChamarMapa: {
    backgroundColor: "#22c55e",
    paddingVertical: 20,
    borderRadius: 20,
  },
  botaoBuscandoMapa: {
    backgroundColor: "#facc15",
    paddingVertical: 20,
    borderRadius: 20,
  },
  textoBotaoMapa: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  },
  caixaMotoristaMapa: {
    backgroundColor: "#f1f5f9",
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  labelMotoristaMapa: {
    color: "#64748b",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 3,
  },
  nomeMotoristaMapa: {
    color: "#16a34a",
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
  },
  infoMotoristaMapa: {
    color: "#475569",
    fontSize: 13,
    textAlign: "center",
    marginTop: 5,
  },
  botaoCancelarMapa: {
    backgroundColor: "#dc2626",
    paddingVertical: 16,
    borderRadius: 18,
  },
  textoBotaoCancelarMapa: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
  },
});
