const fs = require("fs");

const p = "App.js";
let s = fs.readFileSync(p, "utf8");

const inicio = s.indexOf('socketRef.current.on("nova_chamada"');

if (inicio < 0) {
  throw new Error('Nao encontrei socketRef.current.on("nova_chamada")');
}

const proximo = s.indexOf('socketRef.current.on("cancelar_chamada"', inicio);

if (proximo < 0) {
  throw new Error('Nao encontrei socketRef.current.on("cancelar_chamada") depois de nova_chamada');
}

const novoBloco = `socketRef.current.on("nova_chamada", (chamada) => {
      console.log(
        "Nova chamada recebida via Socket.IO ignorada no React. Fluxo nativo/FCM assume:",
        chamada?.idChamada
      );
    });

    const limparChamadaNormalDoReact = (dados = {}) => {
      const idChamada = String(dados.idChamada || "");

      if (!idChamada) {
        return;
      }

      setChamadaAtual((atual) => {
        if (atual && String(atual.idChamada) === idChamada) {
          return null;
        }

        return atual;
      });

      setCorridaAceita(false);
    };

    socketRef.current.on("chamada_aceita", limparChamadaNormalDoReact);
    socketRef.current.on("chamada_recusada", limparChamadaNormalDoReact);
    socketRef.current.on("corrida_finalizada", limparChamadaNormalDoReact);
    socketRef.current.on("corrida_cancelada", limparChamadaNormalDoReact);

    `;

s = s.slice(0, inicio) + novoBloco + s.slice(proximo);

s = s.replaceAll("App do Mototaxista - V10.1", "App do Mototaxista - V10.2");
s = s.replaceAll("App do Mototaxista - V10.0", "App do Mototaxista - V10.2");
s = s.replaceAll("App do Mototaxista - V9.8", "App do Mototaxista - V10.2");
s = s.replaceAll("App do Mototaxista - V9.7", "App do Mototaxista - V10.2");

fs.writeFileSync(p, s, "utf8");

console.log("App.js corrigido: nova_chamada nao cria mais card normal no React.");