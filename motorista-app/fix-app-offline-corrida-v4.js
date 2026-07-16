const fs = require("fs");

const p = "App.js";
let s = fs.readFileSync(p, "utf8");

function acharFuncao(nome) {
  const inicio = s.indexOf(`  async function ${nome}(`);
  if (inicio < 0) {
    throw new Error(`Nao encontrei a funcao ${nome}.`);
  }

  const abre = s.indexOf("{", inicio);
  if (abre < 0) {
    throw new Error(`Nao encontrei abertura da funcao ${nome}.`);
  }

  let nivel = 0;
  for (let i = abre; i < s.length; i++) {
    const c = s[i];

    if (c === "{") nivel++;
    if (c === "}") nivel--;

    if (nivel === 0) {
      return {
        inicio,
        fim: i + 1,
        texto: s.slice(inicio, i + 1),
      };
    }
  }

  throw new Error(`Nao encontrei fechamento da funcao ${nome}.`);
}

const func = acharFuncao("ficarOnlineOffline");
let f = func.texto;

// Troca SOMENTE o trecho do else de ficar offline.
// Não toca em sairDaConta.
const reOffline =
  /socketRef\.current\.emit\("motorista_offline"\);\s*await pararMonitoramentoLocalizacao\(\);\s*onlineRef\.current = false;\s*setOnline\(false\);\s*setLocalizacao\(null\);\s*setChamadaAtual\(null\);\s*setCorridaAceita\(false\);\s*setModoLocalizacao\("economico"\);/m;

const novoOffline = `socketRef.current.emit("motorista_offline");

      await pararMonitoramentoLocalizacao();

      onlineRef.current = false;
      setOnline(false);
      setLocalizacao(null);

      if (chamadaAtual && corridaAceita) {
        console.log(
          "Motorista ficou offline, mas corrida aceita continua visivel:",
          chamadaAtual.idChamada
        );
      } else {
        setChamadaAtual(null);
        setCorridaAceita(false);
      }

      setModoLocalizacao("economico");`;

if (!f.includes("corrida aceita continua visivel")) {
  if (!reOffline.test(f)) {
    throw new Error("Nao encontrei o bloco offline dentro de ficarOnlineOffline.");
  }

  f = f.replace(reOffline, novoOffline);
}

// Ao voltar online, se o backend devolver corridaAtiva, restaura o card.
const reOnline =
  /await iniciarMonitoramentoLocalizacao\("economico"\);\s*onlineRef\.current = true;\s*setOnline\(true\);/m;

const novoOnline = `if (resposta.corridaAtiva) {
            console.log("Corrida ativa recuperada ao ficar online:", resposta.corridaAtiva);

            setChamadaAtual({
              idChamada: resposta.corridaAtiva.idChamada,
              cliente: resposta.corridaAtiva.cliente || "Cliente",
              endereco: resposta.corridaAtiva.endereco || "Endereco nao informado",
              observacao: resposta.corridaAtiva.observacao || "",
              latitudePassageiro: resposta.corridaAtiva.latitudePassageiro,
              longitudePassageiro: resposta.corridaAtiva.longitudePassageiro,
              distancia: resposta.corridaAtiva.distancia || "",
              tempo: resposta.corridaAtiva.tempo || "",
              origem: resposta.corridaAtiva.origem || "Despacho",
              tokenTentativa: resposta.corridaAtiva.tokenTentativa || "",
            });

            setCorridaAceita(true);
            await iniciarMonitoramentoLocalizacao("alta_precisao");
          } else {
            await iniciarMonitoramentoLocalizacao("economico");
          }

          onlineRef.current = true;
          setOnline(true);`;

if (!f.includes("Corrida ativa recuperada ao ficar online")) {
  if (!reOnline.test(f)) {
    throw new Error("Nao encontrei o bloco online dentro de ficarOnlineOffline.");
  }

  f = f.replace(reOnline, novoOnline);
}

s = s.slice(0, func.inicio) + f + s.slice(func.fim);

s = s.replaceAll("App do Mototaxista - V10.7", "App do Mototaxista - V10.8");
s = s.replaceAll("App do Mototaxista - V10.6", "App do Mototaxista - V10.8");
s = s.replaceAll("App do Mototaxista - V10.5", "App do Mototaxista - V10.8");
s = s.replaceAll("App do Mototaxista - V10.4", "App do Mototaxista - V10.8");

fs.writeFileSync(p, s, "utf8");

console.log("OK: patch aplicado somente em ficarOnlineOffline.");