import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Modal,
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
import { WebView } from "react-native-webview";
import { io } from "socket.io-client";

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || "http://207.180.245.177:3001").replace(/\/$/, "");
const STORAGE_PASSAGEIRO = "cornelio_move_passageiro_sessao_v1";

const MAPA_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
  />
  <link
    rel="stylesheet"
    href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  />
  <style>
    html, body, #map {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #e5e7eb;
      overflow: hidden;
      font-family: Arial, sans-serif;
    }

    .pin {
      min-width: 68px;
      transform: translate(-50%, -100%);
      border-radius: 999px;
      padding: 8px 10px;
      color: #ffffff;
      font-size: 12px;
      font-weight: bold;
      text-align: center;
      box-shadow: 0 8px 18px rgba(0,0,0,0.25);
      border: 2px solid #ffffff;
      white-space: nowrap;
    }

    .pin-passageiro {
      background: #2563eb;
    }

    .pin-motorista {
      background: #16a34a;
    }

    .leaflet-control-attribution {
      font-size: 10px;
    }
  </style>
</head>
<body>
  <div id="map"></div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const CENTRO_PADRAO = [-23.1829, -50.6465];

    const mapa = L.map("map", {
      zoomControl: false,
      attributionControl: true
    }).setView(CENTRO_PADRAO, 15);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap"
    }).addTo(mapa);

    let marcadorPassageiro = null;
    let marcadorMotorista = null;

    function numero(valor) {
      const n = Number(valor);
      return Number.isFinite(n) ? n : null;
    }

    function criarIcone(classe, texto) {
      return L.divIcon({
        className: "",
        html: '<div class="pin ' + classe + '">' + texto + '</div>',
        iconSize: [1, 1],
        iconAnchor: [0, 0]
      });
    }

    function atualizarMarcador(atual, coords, classe, texto) {
      const lat = numero(coords && coords.latitude);
      const lng = numero(coords && coords.longitude);

      if (lat === null || lng === null) {
        if (atual) {
          mapa.removeLayer(atual);
        }
        return null;
      }

      if (!atual) {
        return L.marker([lat, lng], {
          icon: criarIcone(classe, texto)
        }).addTo(mapa);
      }

      atual.setLatLng([lat, lng]);
      return atual;
    }

    function atualizarMapa(dados) {
      try {
        dados = dados || {};

        marcadorPassageiro = atualizarMarcador(
          marcadorPassageiro,
          dados.passageiro,
          "pin-passageiro",
          "Você"
        );

        marcadorMotorista = atualizarMarcador(
          marcadorMotorista,
          dados.motorista,
          "pin-motorista",
          "Mototáxi"
        );

        const pontos = [];

        if (marcadorPassageiro) {
          pontos.push(marcadorPassageiro.getLatLng());
        }

        if (marcadorMotorista) {
          pontos.push(marcadorMotorista.getLatLng());
        }

        if (pontos.length >= 2) {
          mapa.fitBounds(L.latLngBounds(pontos), {
            padding: [80, 80],
            maxZoom: 16
          });
        } else if (pontos.length === 1) {
          mapa.setView(pontos[0], 16);
        }
      } catch (erro) {
        console.log("Erro ao atualizar mapa:", erro && erro.message);
      }
    }

    window.atualizarMapa = atualizarMapa;
  </script>
</body>
</html>`;

function normalizarCelular(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function coordenadaValida(coords) {
  return (
    coords &&
    Number.isFinite(Number(coords.latitude)) &&
    Number.isFinite(Number(coords.longitude))
  );
}

export default function App() {
  const socketRef = useRef(null);
  const mapaRef = useRef(null);
  const passageiroRef = useRef(null);
  const tokenSessaoRef = useRef(null);
  const restaurandoAuthRef = useRef(false);

  const [conectado, setConectado] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [status, setStatus] = useState("Faca login para chamar um mototaxi.");
  const [localizacao, setLocalizacao] = useState(null);
  const [motoristaAceitou, setMotoristaAceitou] = useState(null);
  const [motoristaLocalizacao, setMotoristaLocalizacao] = useState(null);
  const [chamadaAtual, setChamadaAtual] = useState(null);
  const [mapaPronto, setMapaPronto] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);

  const [modoAuth, setModoAuth] = useState("login");
  const [passageiro, setPassageiro] = useState(null);
  const [tokenSessao, setTokenSessao] = useState(null);

  const [nome, setNome] = useState("");
  const [celular, setCelular] = useState("");
  const [senha, setSenha] = useState("");
  const [authCarregando, setAuthCarregando] = useState(false);
  const [restaurandoSessao, setRestaurandoSessao] = useState(true);

  function atualizarMapaWebView(proximaLocalizacao = localizacao, proximoMotorista = motoristaLocalizacao) {
    if (!mapaPronto || !mapaRef.current) {
      return;
    }

    const dadosMapa = {
      passageiro: coordenadaValida(proximaLocalizacao)
        ? {
            latitude: Number(proximaLocalizacao.latitude),
            longitude: Number(proximaLocalizacao.longitude),
            accuracy: proximaLocalizacao.accuracy || "",
          }
        : null,
      motorista: coordenadaValida(proximoMotorista)
        ? {
            latitude: Number(proximoMotorista.latitude),
            longitude: Number(proximoMotorista.longitude),
            accuracy: proximoMotorista.accuracy || "",
          }
        : null,
    };

    mapaRef.current.injectJavaScript(
      `window.atualizarMapa(${JSON.stringify(dadosMapa)}); true;`
    );
  }

  useEffect(() => {
    atualizarMapaWebView();
  }, [mapaPronto, localizacao, motoristaLocalizacao]);

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

    pegarLocalizacao(false);
  }, [passageiro?.idPassageiro, tokenSessao]);

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
        setMotoristaLocalizacao(null);
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
        idMotorista: dados.idMotorista,
      });

      if (coordenadaValida({
        latitude: dados.latitudeMotorista,
        longitude: dados.longitudeMotorista,
      })) {
        setMotoristaLocalizacao({
          latitude: Number(dados.latitudeMotorista),
          longitude: Number(dados.longitudeMotorista),
          accuracy: dados.accuracyMotorista || "",
          idMotorista: dados.idMotorista,
          nomeMotorista: dados.nomeMotorista,
        });
      }

      setStatus(dados.mensagem || `${dados.nomeMotorista} aceitou sua chamada.`);
      setBuscando(false);
    });

    socketRef.current.on("motorista_localizacao_passageiro", (dados) => {
      const idAtual = String(chamadaAtual?.idChamada || "");
      const idRecebido = String(dados?.idChamada || "");

      if (idAtual && idRecebido && idAtual !== idRecebido) {
        return;
      }

      if (!coordenadaValida(dados)) {
        return;
      }

      setMotoristaLocalizacao({
        latitude: Number(dados.latitude),
        longitude: Number(dados.longitude),
        accuracy: dados.accuracy || "",
        idMotorista: dados.idMotorista || "",
        nomeMotorista: dados.nomeMotorista || motoristaAceitou || "Mototaxista",
      });
    });

    socketRef.current.on("corrida_finalizada_passageiro", (dados) => {
      setStatus(dados.mensagem || "Corrida finalizada.");
      setBuscando(false);
      setMotoristaAceitou(null);
      setMotoristaLocalizacao(null);
      setChamadaAtual(null);
    });

    socketRef.current.on("corrida_cancelada_passageiro", (dados) => {
      setStatus(dados.mensagem || "Corrida cancelada.");
      setBuscando(false);
      setMotoristaAceitou(null);
      setMotoristaLocalizacao(null);
      setChamadaAtual(null);
      Alert.alert("Corrida cancelada", dados.mensagem || "Corrida cancelada.");
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [passageiro, tokenSessao, chamadaAtual?.idChamada, motoristaAceitou]);

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
    setMotoristaLocalizacao(null);
    setChamadaAtual(null);
    setMenuAberto(false);
    passageiroRef.current = null;
    tokenSessaoRef.current = null;
    setPassageiro(null);
    setTokenSessao(null);
  }

  async function pegarLocalizacao(mostrarAlerta = true) {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        if (mostrarAlerta) {
          Alert.alert("Permissao negada", "Nao foi possivel acessar sua localizacao.");
        }

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
      atualizarMapaWebView(coords, motoristaLocalizacao);

      return coords;
    } catch (error) {
      if (mostrarAlerta) {
        Alert.alert("Erro", "Erro ao pegar localizacao: " + error.message);
      }

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
    setMotoristaLocalizacao(null);
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
        setMotoristaLocalizacao(null);
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
      <ScrollView contentContainerStyle={styles.containerLogin}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.titulo}>Cornelio Move</Text>
        <Text style={styles.subtitulo}>Restaurando sessao do passageiro...</Text>
      </ScrollView>
    );
  }

  if (!passageiro) {
    return (
      <ScrollView contentContainerStyle={styles.containerLogin}>
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
    <View style={styles.telaMapa}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <WebView
        ref={mapaRef}
        style={styles.webviewMapa}
        source={{ html: MAPA_HTML }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        onLoadEnd={() => {
          setMapaPronto(true);
          setTimeout(() => atualizarMapaWebView(), 250);
        }}
      />

      <View style={styles.topoMapa}>
        <View style={styles.logoMini}>
          <Text style={styles.logoMiniTexto}>Cornelio Move</Text>
          <Text style={styles.logoMiniSubtexto}>{conectado ? "Conectado" : "Desconectado"}</Text>
        </View>

        <TouchableOpacity style={styles.botaoMenuMapa} onPress={() => setMenuAberto(true)}>
          <Text style={styles.iconeMenu}>☰</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.painelInferior}>
        <Text style={styles.statusMapa}>{status}</Text>

        {motoristaAceitou && (
          <Text style={styles.motoristaMapa}>Mototaxista: {motoristaAceitou}</Text>
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
            <Text style={styles.textoBotaoCancelar}>Cancelar corrida</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.botaoAtualizarLocalizacao} onPress={() => pegarLocalizacao()}>
          <Text style={styles.textoAtualizarLocalizacao}>Atualizar minha localização</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={menuAberto}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuAberto(false)}
      >
        <TouchableOpacity
          style={styles.fundoModalMenu}
          activeOpacity={1}
          onPress={() => setMenuAberto(false)}
        >
          <View style={styles.cardMenu}>
            <Text style={styles.menuTitulo}>Minha conta</Text>
            <Text style={styles.nomePassageiro}>{passageiro.nome}</Text>
            <Text style={styles.celularPassageiro}>{passageiro.celular}</Text>

            <View style={styles.divisorMenu} />

            <Text style={styles.menuInfo}>
              {conectado ? "Servidor conectado" : "Servidor desconectado"}
            </Text>

            <TouchableOpacity style={styles.botaoSair} onPress={() => sairDaConta(true)}>
              <Text style={styles.textoBotaoSair}>Sair da conta</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  containerLogin: {
    flexGrow: 1,
    backgroundColor: "#111827",
    padding: 20,
    justifyContent: "center",
  },
  telaMapa: {
    flex: 1,
    backgroundColor: "#e5e7eb",
  },
  webviewMapa: {
    flex: 1,
    backgroundColor: "#e5e7eb",
  },
  topoMapa: {
    position: "absolute",
    top: 44,
    left: 16,
    right: 16,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logoMini: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  logoMiniTexto: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "bold",
  },
  logoMiniSubtexto: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 2,
  },
  botaoMenuMapa: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  iconeMenu: {
    color: "#111827",
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "bold",
  },
  painelInferior: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 24,
    zIndex: 10,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 28,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  statusMapa: {
    color: "#334155",
    fontSize: 16,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 14,
    fontWeight: "600",
  },
  motoristaMapa: {
    color: "#16a34a",
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 14,
  },
  botaoChamarMapa: {
    backgroundColor: "#22c55e",
    padding: 20,
    borderRadius: 18,
  },
  botaoBuscandoMapa: {
    backgroundColor: "#facc15",
    padding: 20,
    borderRadius: 18,
  },
  textoBotaoMapa: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  },
  botaoCancelarMapa: {
    backgroundColor: "#dc2626",
    padding: 16,
    borderRadius: 16,
  },
  botaoAtualizarLocalizacao: {
    marginTop: 12,
    padding: 10,
  },
  textoAtualizarLocalizacao: {
    color: "#2563eb",
    fontWeight: "bold",
    textAlign: "center",
  },
  fundoModalMenu: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.38)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 92,
    paddingRight: 16,
  },
  cardMenu: {
    width: 270,
    backgroundColor: "#ffffff",
    borderRadius: 22,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  menuTitulo: {
    color: "#64748b",
    fontSize: 13,
    textTransform: "uppercase",
    fontWeight: "bold",
    marginBottom: 8,
  },
  menuInfo: {
    color: "#475569",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 12,
  },
  divisorMenu: {
    height: 1,
    backgroundColor: "#e5e7eb",
    marginVertical: 14,
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
  nomePassageiro: {
    color: "#111827",
    fontSize: 21,
    fontWeight: "bold",
    textAlign: "center",
  },
  celularPassageiro: {
    color: "#475569",
    fontSize: 15,
    textAlign: "center",
    marginTop: 4,
  },
  botaoSair: {
    backgroundColor: "#4b5563",
    padding: 13,
    borderRadius: 14,
    marginTop: 12,
  },
  textoBotaoSair: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "bold",
    textAlign: "center",
  },
  textoBotaoCancelar: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
  },
});
