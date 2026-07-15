const fs = require("fs");

const p = "App.js";
let s = fs.readFileSync(p, "utf8");

const efeitoPolling = `
  useEffect(() => {
    if (!conectado || !motoristaLogado || !online) {
      return;
    }

    const deveBuscar = () => {
      if (!chamadaAtual) {
        return true;
      }

      if (!chamadaAtual.idChamada || !chamadaAtual.tokenTentativa) {
        return true;
      }

      return false;
    };

    if (deveBuscar()) {
      buscarChamadaPendenteNoBackend("polling_inicial");
    }

    const intervalo = setInterval(() => {
      if (deveBuscar()) {
        buscarChamadaPendenteNoBackend("polling_online");
      }
    }, 1000);

    return () => clearInterval(intervalo);
  }, [
    conectado,
    motoristaLogado,
    online,
    chamadaAtual?.idChamada,
    chamadaAtual?.tokenTentativa,
  ]);

`;

if (!s.includes('buscarChamadaPendenteNoBackend("polling_online")')) {
  s = s.replace(
    "  useEffect(() => {\n    configurarNotificacoesPush();",
    efeitoPolling + "  useEffect(() => {\n    configurarNotificacoesPush();"
  );
}

s = s.replace(
`    socketRef.current.on("nova_chamada", (chamada) => {
      setChamadaAtual(chamada);
      setCorridaAceita(false);
    });`,
`    socketRef.current.on("nova_chamada", async (chamada) => {
      await limparNotificacoesDaCorrida();

      const chamadaNormalizada = normalizarChamadaBackend(chamada);

      setChamadaAtual(chamadaNormalizada);
      setCorridaAceita(false);

      setTimeout(() => {
        if (!chamadaNormalizada.idChamada || !chamadaNormalizada.tokenTentativa) {
          buscarChamadaPendenteNoBackend("socket_nova_chamada_sem_dados");
        }
      }, 300);
    });`
);

s = s.replace(
`  async function aceitarChamada() {
    if (!chamadaAtual) return;
    await aceitarChamadaObjeto(chamadaAtual);
  }`,
`  async function aceitarChamada() {
    if (!chamadaAtual) return;

    if (!chamadaAtual.idChamada || !chamadaAtual.tokenTentativa) {
      await buscarChamadaPendenteNoBackend("aceitar_sem_dados");

      setTimeout(() => {
        if (chamadaAtualRef.current?.idChamada && chamadaAtualRef.current?.tokenTentativa) {
          aceitarChamadaObjeto(chamadaAtualRef.current);
        }
      }, 500);

      return;
    }

    await aceitarChamadaObjeto(chamadaAtual);
  }`
);

if (!s.includes("const chamadaAtualRef = useRef(null);")) {
  s = s.replace(
    "  const buscandoChamadaPendenteRef = useRef(false);",
    "  const buscandoChamadaPendenteRef = useRef(false);\n  const chamadaAtualRef = useRef(null);"
  );
}

if (!s.includes("chamadaAtualRef.current = chamadaAtual")) {
  s = s.replace(
    "  useEffect(() => {\n    onlineRef.current = online;\n  }, [online]);",
    `  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  useEffect(() => {
    chamadaAtualRef.current = chamadaAtual;
  }, [chamadaAtual]);`
  );
}

s = s.replaceAll("App do Mototaxista - V9.6", "App do Mototaxista - V9.7");
s = s.replaceAll("App do Mototaxista - V9.5", "App do Mototaxista - V9.7");

fs.writeFileSync(p, s, "utf8");
console.log("App.js v9.7 corrigido: polling de chamada pendente e aceitar sem dados.");
