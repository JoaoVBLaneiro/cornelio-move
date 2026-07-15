const fs = require("fs");

const p = "App.js";
let s = fs.readFileSync(p, "utf8");

// Para parar a bagunca de encoding, deixamos os textos fixos sem acento.
// Os dados vindos da corrida continuam vindo decodificados por URL.
const trocas = [
  [/CornÃ©lio Move/g, "Cornelio Move"],
  [/Corn├⌐lio Move/g, "Cornelio Move"],
  [/Cornélio Move/g, "Cornelio Move"],

  [/ConexÃ£o/g, "Conexao"],
  [/Conex├úo/g, "Conexao"],
  [/Conexão/g, "Conexao"],

  [/precisÃ£o/g, "precisao"],
  [/precis├úo/g, "precisao"],
  [/precisão/g, "precisao"],

  [/PrecisÃ£o/g, "Precisao"],
  [/Precis├úo/g, "Precisao"],
  [/Precisão/g, "Precisao"],

  [/EconÃ´mico/g, "Economico"],
  [/Econ├┤mico/g, "Economico"],
  [/Econômico/g, "Economico"],

  [/obrigatÃ³rio/g, "obrigatorio"],
  [/obrigat├│rio/g, "obrigatorio"],
  [/obrigatório/g, "obrigatorio"],

  [/DistÃ¢ncia/g, "Distancia"],
  [/Dist├óncia/g, "Distancia"],
  [/Distância/g, "Distancia"],

  [/VÃ¡ atÃ©/g, "Va ate"],
  [/V├í at├⌐/g, "Va ate"],
  [/Vá até/g, "Va ate"],

  [/navegaÃ§Ã£o/g, "navegacao"],
  [/navega├º├úo/g, "navegacao"],
  [/navegação/g, "navegacao"],

  [/aparecerÃ¡/g, "aparecera"],
  [/aparecerá/g, "aparecera"],

  [/â€¢/g, "-"],
  [/â€“/g, "-"],
  [/â€”/g, "-"],
  [/â€˜/g, "'"],
  [/â€™/g, "'"],
  [/â€œ/g, '"'],
  [/â€�/g, '"'],
];

for (const [de, para] of trocas) {
  s = s.replace(de, para);
}

// Garante import do Linking
s = s.replace(/import \{([\s\S]*?)\} from "react-native";/, (m, itens) => {
  if (itens.includes("Linking")) return m;
  return `import {${itens}  Linking,\n} from "react-native";`;
});

const blocoDeepLink = `
  function decodificarParametro(valor) {
    try {
      return decodeURIComponent(String(valor || "").replace(/\\\\+/g, " "));
    } catch (error) {
      return String(valor || "");
    }
  }

  function processarUrlCorrida(url) {
    if (!url || !String(url).includes("nova-corrida")) {
      return;
    }

    const textoUrl = String(url);
    const indiceQuery = textoUrl.indexOf("?");

    if (indiceQuery < 0) {
      console.log("URL de corrida sem query:", textoUrl);
      return;
    }

    const query = textoUrl.slice(indiceQuery + 1).split("#")[0];
    const params = {};

    query.split("&").forEach((parte) => {
      if (!parte) return;

      const pedacos = parte.split("=");
      const chave = decodificarParametro(pedacos.shift());
      const valor = decodificarParametro(pedacos.join("="));

      if (chave) {
        params[chave] = valor;
      }
    });

    const chamada = {
      idChamada: params.idChamada || "",
      tokenTentativa: params.tokenTentativa || "",
      cliente: params.cliente || "Cliente",
      endereco: params.endereco || "Endereco nao informado",
      observacao: params.observacao || "",
      latitudePassageiro: params.latitudePassageiro || "",
      longitudePassageiro: params.longitudePassageiro || "",
      distancia: params.distancia || "",
      tempo: params.tempo || "",
      origem: params.origem || "Despacho",
    };

    console.log("Corrida recebida por deep link:", chamada);

    if (!chamada.idChamada || !chamada.tokenTentativa) {
      console.log("Deep link de corrida sem idChamada/tokenTentativa:", params);
      return;
    }

    setChamadaAtual(chamada);
    setCorridaAceita(false);
  }

  useEffect(() => {
    let ativo = true;

    Linking.getInitialURL()
      .then((url) => {
        if (ativo) {
          processarUrlCorrida(url);
        }
      })
      .catch((error) => {
        console.log("Erro ao ler URL inicial:", error.message);
      });

    const assinatura = Linking.addEventListener("url", (evento) => {
      processarUrlCorrida(evento.url);
    });

    return () => {
      ativo = false;

      if (assinatura && assinatura.remove) {
        assinatura.remove();
      }
    };
  }, []);

`;

// Insere o bloco antes do primeiro useEffect, se ainda nao existir
if (!s.includes("function processarUrlCorrida")) {
  s = s.replace("  useEffect(() => {\n", blocoDeepLink + "  useEffect(() => {\n");
}

s = s.replace("App do Mototaxista - V9.3", "App do Mototaxista - V9.5");
s = s.replace("App do Mototaxista - V9.4", "App do Mototaxista - V9.5");
s = s.replace("App do Mototaxista - V9.1", "App do Mototaxista - V9.5");

fs.writeFileSync(p, s, "utf8");

console.log("App.js corrigido: textos + deep link de corrida.");
