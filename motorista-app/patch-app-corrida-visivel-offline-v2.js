const fs = require("fs");

const p = "App.js";
let s = fs.readFileSync(p, "utf8");

// Corrige o bloco do botão "Ficar Offline".
// Estratégia: começa no emit("motorista_offline") e vai até setModoLocalizacao("economico").
const marcadorOffline = 'socketRef.current.emit("motorista_offline");';
const idxOffline = s.indexOf(marcadorOffline);

if (idxOffline < 0) {
  throw new Error('Nao encontrei socketRef.current.emit("motorista_offline");');
}

const marcadorFimOffline = 'setModoLocalizacao("economico");';
const idxFimOffline = s.indexOf(marcadorFimOffline, idxOffline);

if (idxFimOffline < 0) {
  throw new Error('Nao encontrei setModoLocalizacao("economico") depois do motorista_offline.');
}

const fimLinhaOffline = s.indexOf("\n", idxFimOffline);
const fimBlocoOffline =
  fimLinhaOffline >= 0
    ? fimLinhaOffline + 1
    : idxFimOffline + marcadorFimOffline.length;

const trechoOfflineAtual = s.slice(idxOffline, fimBlocoOffline);

const trechoOfflineNovo = `socketRef.current.emit("motorista_offline");

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

      setModoLocalizacao("economico");
`;

if (!trechoOfflineAtual.includes("corrida aceita continua visivel")) {
  s = s.slice(0, idxOffline) + trechoOfflineNovo + s.slice(fimBlocoOffline);
}

// Ao voltar online, se o backend devolver corridaAtiva, restaura o card.
const regexOnline =
  /await iniciarMonitoramentoLocalizacao\("economico"\);\s*\r?\n\s*onlineRef\.current = true;\s*\r?\n\s*setOnline\(true\);/;

const trechoOnlineNovo = `if (resposta.corridaAtiva) {
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

if (!s.includes("Corrida ativa recuperada ao ficar online")) {
  if (!regexOnline.test(s)) {
    throw new Error("Nao encontrei bloco de sucesso do motorista_online.");
  }

  s = s.replace(regexOnline, trechoOnlineNovo);
}

s = s.replaceAll("App do Mototaxista - V10.6", "App do Mototaxista - V10.7");
s = s.replaceAll("App do Mototaxista - V10.5", "App do Mototaxista - V10.7");
s = s.replaceAll("App do Mototaxista - V10.4", "App do Mototaxista - V10.7");

fs.writeFileSync(p, s, "utf8");

console.log("App.js corrigido: corrida aceita continua visivel mesmo com motorista offline.");