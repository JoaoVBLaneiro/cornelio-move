const fs = require("fs");

const p = "App.js";
let s = fs.readFileSync(p, "utf8");

if (!s.includes("buscandoChamadaPendenteRef")) {
  s = s.replace(
    "  const fcmTokenRef = useRef(null);",
    "  const fcmTokenRef = useRef(null);\n  const buscandoChamadaPendenteRef = useRef(false);"
  );
}

const blocoBusca = `
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

      const url = \`\${BACKEND_URL}/motorista/chamada-pendente/\${encodeURIComponent(
        motoristaAtual.login
      )}?t=\${Date.now()}\`;

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

`;

if (!s.includes("buscarChamadaPendenteNoBackend")) {
  s = s.replace("  function obterChamadaDaNotificacao(response) {", blocoBusca + "  function obterChamadaDaNotificacao(response) {");
}

s = s.replace(
`      if (
        desejaFicarOnlineRef.current &&
        motoristaLogadoRef.current &&
        tokenSessaoRef.current
      ) {
        restaurarOnlineAutomaticamente();
      }
    });`,
`      if (
        desejaFicarOnlineRef.current &&
        motoristaLogadoRef.current &&
        tokenSessaoRef.current
      ) {
        restaurarOnlineAutomaticamente();
      }

      setTimeout(() => {
        buscarChamadaPendenteNoBackend("socket_connect");
      }, 800);
    });`
);

if (!s.includes('buscarChamadaPendenteNoBackend("estado_app")')) {
  s = s.replace(
`  useEffect(() => {
    tokenSessaoRef.current = tokenSessao;
  }, [tokenSessao]);

`,
`  useEffect(() => {
    tokenSessaoRef.current = tokenSessao;
  }, [tokenSessao]);

  useEffect(() => {
    if (conectado && motoristaLogado) {
      const timer = setTimeout(() => {
        buscarChamadaPendenteNoBackend("estado_app");
      }, 800);

      return () => clearTimeout(timer);
    }
  }, [conectado, motoristaLogado, online]);

`
  );
}

s = s.replace(
`    socketRef.current.on("nova_chamada", (chamada) => {
      setChamadaAtual(chamada);
      setCorridaAceita(false);
    });`,
`    socketRef.current.on("nova_chamada", async (chamada) => {
      await limparNotificacoesDaCorrida();
      setChamadaAtual(normalizarChamadaBackend(chamada));
      setCorridaAceita(false);
    });`
);

if (!s.includes('buscarChamadaPendenteNoBackend("motorista_online")')) {
  s = s.replaceAll(
`          onlineRef.current = true;
          setOnline(true);`,
`          onlineRef.current = true;
          setOnline(true);

          setTimeout(() => {
            buscarChamadaPendenteNoBackend("motorista_online");
          }, 800);`
  );
}

s = s.replaceAll("App do Mototaxista - V9.5", "App do Mototaxista - V9.6");
s = s.replaceAll("App do Mototaxista - V9.4", "App do Mototaxista - V9.6");
s = s.replaceAll("App do Mototaxista - V9.3", "App do Mototaxista - V9.6");

const trocas = {
  "NotificaÃ§Ãµes": "Notificacoes",
  "nÃ£o": "nao",
  "NÃ£o": "Nao",
  "possÃ­vel": "possivel",
  "conexÃ£o": "conexao",
  "invÃ¡lida": "invalida",
  "invÃ¡lido": "invalido",
  "FaÃ§a": "Faca",
  "dÃ­gitos": "digitos",
  "indisponÃ­vel": "indisponivel",
  "estÃ¡": "esta",
  "AtenÃ§Ã£o": "Atencao",
  "vocÃª": "voce",
  "NavegaÃ§Ã£o": "Navegacao",
  "ConfiguraÃ§Ã£o": "Configuracao",
  "obrigatÃ³ria": "obrigatoria",
  "Ã§": "c",
  "Ã£": "a",
  "Ã¡": "a",
  "Ã©": "e",
  "Ã­": "i",
  "Ã³": "o",
  "Ãª": "e",
  "Ã´": "o",
  "â€¢": "-",
  "â€“": "-",
  "â€”": "-",
};

for (const [de, para] of Object.entries(trocas)) {
  s = s.split(de).join(para);
}

fs.writeFileSync(p, s, "utf8");
console.log("App.js v9.6 corrigido: busca chamada pendente, limpa notificacoes e textos.");
