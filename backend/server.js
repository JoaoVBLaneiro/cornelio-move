require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const motoristas = new Map();
const chamadas = new Map();

const TEMPO_RESPOSTA_MOTORISTA_MS = 15000;

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || "";
const GEOAPIFY_DAILY_LIMIT = Number(process.env.GEOAPIFY_DAILY_LIMIT || 2500);

const geoapifyUso = {
  dia: null,
  consultas: 0,
};

function obterDiaAtualBrasil() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function atualizarContadorGeoapify() {
  const diaAtual = obterDiaAtualBrasil();

  if (geoapifyUso.dia !== diaAtual) {
    geoapifyUso.dia = diaAtual;
    geoapifyUso.consultas = 0;
  }
}

function podeConsultarGeoapify() {
  atualizarContadorGeoapify();

  if (!GEOAPIFY_API_KEY) {
    console.log("Geoapify sem API key configurada. Usando endereço padrão.");
    return false;
  }

  if (geoapifyUso.consultas >= GEOAPIFY_DAILY_LIMIT) {
    console.log("Limite diário interno da Geoapify atingido:", {
      dia: geoapifyUso.dia,
      consultas: geoapifyUso.consultas,
      limite: GEOAPIFY_DAILY_LIMIT,
    });
    return false;
  }

  return true;
}

function montarEnderecoGeoapify(resultado) {
  if (!resultado) {
    return null;
  }

  if (resultado.formatted) {
    return resultado.formatted;
  }

  const partes = [
    resultado.address_line1,
    resultado.address_line2,
    resultado.street,
    resultado.suburb,
    resultado.city,
    resultado.state,
  ].filter(Boolean);

  if (partes.length === 0) {
    return null;
  }

  return partes.join(", ");
}

async function obterEnderecoPorCoordenadas(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    console.log("Coordenadas inválidas para reverse geocoding:", {
      latitude,
      longitude,
    });
    return null;
  }

  if (!podeConsultarGeoapify()) {
    return null;
  }

  geoapifyUso.consultas += 1;

  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    lang: "pt",
    format: "json",
    apiKey: GEOAPIFY_API_KEY,
  });

  const url = `https://api.geoapify.com/v1/geocode/reverse?${params.toString()}`;

  try {
    const resposta = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!resposta.ok) {
      console.log("Erro na Geoapify:", {
        status: resposta.status,
        statusText: resposta.statusText,
      });
      return null;
    }

    const dados = await resposta.json();
    const resultado = Array.isArray(dados.results) ? dados.results[0] : null;
    const endereco = montarEnderecoGeoapify(resultado);

    if (!endereco) {
      console.log("Geoapify não encontrou endereço para as coordenadas.");
      return null;
    }

    console.log("Endereço obtido pela Geoapify:", {
      endereco,
      consultasHoje: geoapifyUso.consultas,
      limiteDiario: GEOAPIFY_DAILY_LIMIT,
    });

    return endereco;
  } catch (error) {
    console.log("Falha ao consultar Geoapify:", error.message);
    return null;
  }
}


function enviarListaMotoristas() {
  io.emit("lista_motoristas", Array.from(motoristas.values()));
}

function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = Math.PI / 180;

  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function formatarDistancia(metros) {
  if (metros < 1000) {
    return `${Math.round(metros)} metros`;
  }

  return `${(metros / 1000).toFixed(1).replace(".", ",")} km`;
}

function estimarTempo(metros) {
  const velocidadeMediaMotoMetrosPorMinuto = 500;
  const minutos = Math.max(1, Math.round(metros / velocidadeMediaMotoMetrosPorMinuto));

  if (minutos === 1) {
    return "1 minuto";
  }

  return `${minutos} minutos`;
}

function listarMotoristasPorProximidade(latitude, longitude) {
  return Array.from(motoristas.values())
    .map((motorista) => {
      const distanciaMetros = calcularDistanciaMetros(
        latitude,
        longitude,
        motorista.latitude,
        motorista.longitude
      );

      return {
        ...motorista,
        distanciaMetros,
      };
    })
    .sort((a, b) => a.distanciaMetros - b.distanciaMetros);
}

function limparTimeoutChamada(chamada) {
  if (chamada && chamada.timeoutId) {
    clearTimeout(chamada.timeoutId);
    chamada.timeoutId = null;
  }
}

function tentarProximoMotorista(idChamada, motivo = "proxima_tentativa") {
  const chamada = chamadas.get(idChamada);

  if (!chamada) {
    return;
  }

  limparTimeoutChamada(chamada);

  if (
    chamada.status === "tentando_motorista" &&
    chamada.motoristaAtual &&
    motivo !== "recusada"
  ) {
    io.to(chamada.motoristaAtual.socketId).emit("cancelar_chamada", {
      idChamada,
      mensagem: "Essa chamada foi enviada para outro mototaxista.",
    });
  }

  chamada.indiceAtual += 1;

  if (chamada.indiceAtual >= chamada.motoristasOrdenados.length) {
    chamada.status = "ninguem_atendeu";

    if (chamada.passageiroSocketId) {
      io.to(chamada.passageiroSocketId).emit("status_chamada", {
        status: "ninguem_atendeu",
        mensagem: "Nenhum mototaxista disponível aceitou sua chamada.",
      });
    }

    io.emit("chamada_sem_atendimento", {
      idChamada,
      mensagem: "Nenhum motorista aceitou.",
    });

    console.log("Nenhum motorista aceitou a chamada:", idChamada);

    return;
  }

  const motorista = chamada.motoristasOrdenados[chamada.indiceAtual];

  const motoristaAtualizado = motoristas.get(motorista.socketId);

  if (!motoristaAtualizado) {
    console.log("Motorista saiu antes da tentativa:", motorista.nome);
    tentarProximoMotorista(idChamada, "motorista_offline");
    return;
  }

  const distancia = formatarDistancia(motorista.distanciaMetros);
  const tempo = estimarTempo(motorista.distanciaMetros);
  const tokenTentativa = `${idChamada}-${chamada.indiceAtual}-${Date.now()}`;

  chamada.status = "tentando_motorista";
  chamada.tokenTentativa = tokenTentativa;
  chamada.motoristaAtual = {
    socketId: motorista.socketId,
    idMotorista: motorista.idMotorista,
    nome: motorista.nome,
  };

  chamada.distancia = distancia;
  chamada.tempo = tempo;

  chamadas.set(idChamada, chamada);

  if (chamada.passageiroSocketId) {
    io.to(chamada.passageiroSocketId).emit("status_chamada", {
      status: "tentando_motorista",
      mensagem: `Tentando ${motorista.nome}...`,
      motorista: motorista.nome,
      distancia,
      tempo,
    });
  }

  const chamadaParaMotorista = {
    idChamada,
    cliente: chamada.cliente,
    endereco: chamada.endereco,
    observacao: chamada.observacao,
    latitudePassageiro: chamada.latitudePassageiro,
    longitudePassageiro: chamada.longitudePassageiro,
    distancia,
    tempo,
    origem: chamada.origem,
    motoristaDestino: chamada.motoristaAtual,
    tokenTentativa,
  };

  io.to(motorista.socketId).emit("nova_chamada", chamadaParaMotorista);

  console.log("Tentando motorista:", {
    idChamada,
    motorista: motorista.nome,
    distancia,
    motivo,
  });

  chamada.timeoutId = setTimeout(() => {
    const chamadaAtual = chamadas.get(idChamada);

    if (
      !chamadaAtual ||
      chamadaAtual.status !== "tentando_motorista" ||
      chamadaAtual.tokenTentativa !== tokenTentativa ||
      !chamadaAtual.motoristaAtual ||
      chamadaAtual.motoristaAtual.socketId !== motorista.socketId
    ) {
      return;
    }

    console.log("Motorista não respondeu dentro do tempo:", motorista.nome);

    if (chamadaAtual.passageiroSocketId) {
      io.to(chamadaAtual.passageiroSocketId).emit("status_chamada", {
        status: "motorista_nao_respondeu",
        mensagem: `${motorista.nome} não respondeu. Tentando outro mototaxista...`,
      });
    }

    tentarProximoMotorista(idChamada, "timeout");
  }, TEMPO_RESPOSTA_MOTORISTA_MS);

  chamadas.set(idChamada, chamada);
}

io.on("connection", (socket) => {
  console.log("Novo dispositivo conectado:", socket.id);

  socket.on("motorista_online", (dados) => {
    motoristas.set(socket.id, {
      socketId: socket.id,
      idMotorista: dados.idMotorista,
      nome: dados.nome,
      latitude: dados.latitude,
      longitude: dados.longitude,
      online: true,
      modoLocalizacao: "economico",
      atualizadoEm: new Date(),
    });

    console.log("Motorista online:", dados);
    enviarListaMotoristas();
  });

  socket.on("atualizar_localizacao", (dados) => {
    const motorista = motoristas.get(socket.id);

    if (!motorista) {
      return;
    }

    motorista.latitude = dados.latitude;
    motorista.longitude = dados.longitude;
    motorista.accuracy = dados.accuracy;
    motorista.modoLocalizacao = dados.modoLocalizacao || "economico";
    motorista.atualizadoEm = new Date();

    motoristas.set(socket.id, motorista);

    console.log("Localização atualizada:", {
      nome: motorista.nome,
      modo: motorista.modoLocalizacao,
      latitude: motorista.latitude,
      longitude: motorista.longitude,
    });

    enviarListaMotoristas();
  });

  socket.on("motorista_offline", () => {
    const motorista = motoristas.get(socket.id);

    if (motorista) {
      console.log("Motorista offline:", motorista.nome);
    }

    motoristas.delete(socket.id);
    enviarListaMotoristas();
  });

  socket.on("passageiro_chamar", async (dados) => {
    console.log("Chamada rápida recebida do passageiro:", dados);

    const motoristasOrdenados = listarMotoristasPorProximidade(
      dados.latitude,
      dados.longitude
    );

    if (motoristasOrdenados.length === 0) {
      socket.emit("status_chamada", {
        status: "sem_motoristas",
        mensagem: "Nenhum mototaxista online no momento.",
      });

      return;
    }

    const enderecoPassageiro =
      (await obterEnderecoPorCoordenadas(dados.latitude, dados.longitude)) ||
      "Localização atual do passageiro";

    const idChamada = Date.now().toString();

    const chamada = {
      idChamada,
      cliente: dados.nome || "Passageiro do app",
      endereco: enderecoPassageiro,
      observacao: "Chamada rápida pelo app do passageiro",
      latitudePassageiro: dados.latitude,
      longitudePassageiro: dados.longitude,
      origem: "App passageiro",
      passageiroSocketId: socket.id,
      motoristasOrdenados,
      indiceAtual: -1,
      status: "criada",
      timeoutId: null,
    };

    chamadas.set(idChamada, chamada);

    tentarProximoMotorista(idChamada, "primeira_tentativa");
  });

  socket.on("aceitar_chamada", (dados, callback) => {
  console.log("Tentativa de aceite:", dados);

  const chamada = chamadas.get(dados.idChamada);

  if (!chamada) {
    const resposta = {
      ok: false,
      mensagem: "Essa chamada não está mais disponível.",
    };

    socket.emit("chamada_indisponivel", {
      idChamada: dados.idChamada,
      mensagem: resposta.mensagem,
    });

    if (callback) callback(resposta);
    return;
  }

  if (
    chamada.status !== "tentando_motorista" ||
    !chamada.motoristaAtual ||
    chamada.motoristaAtual.socketId !== socket.id ||
    chamada.tokenTentativa !== dados.tokenTentativa
  ) {
    const resposta = {
      ok: false,
      mensagem: "Essa chamada já foi enviada para outro mototaxista.",
    };

    socket.emit("chamada_indisponivel", {
      idChamada: dados.idChamada,
      mensagem: resposta.mensagem,
    });

    if (callback) callback(resposta);
    return;
  }

  limparTimeoutChamada(chamada);

  chamada.status = "aceita";
  chamada.motoristaAceitou = {
    socketId: socket.id,
    idMotorista: dados.idMotorista,
    nomeMotorista: dados.nomeMotorista,
  };

  chamadas.set(dados.idChamada, chamada);

  console.log("Chamada aceita:", dados);

  io.emit("chamada_aceita", dados);

  if (chamada.passageiroSocketId) {
    io.to(chamada.passageiroSocketId).emit("chamada_aceita_passageiro", {
      idChamada: dados.idChamada,
      nomeMotorista: dados.nomeMotorista,
      idMotorista: dados.idMotorista,
      endereco: dados.endereco,
      mensagem: `${dados.nomeMotorista} aceitou sua chamada.`,
    });
  }

  if (callback) {
    callback({
      ok: true,
      mensagem: "Chamada aceita com sucesso.",
    });
  }
});

  socket.on("recusar_chamada", (dados) => {
    console.log("Chamada recusada:", dados);

    const chamada = chamadas.get(dados.idChamada);

    if (!chamada) {
      socket.emit("chamada_indisponivel", {
        idChamada: dados.idChamada,
        mensagem: "Essa chamada não está mais disponível.",
      });
      return;
    }

    if (
      chamada.status !== "tentando_motorista" ||
      !chamada.motoristaAtual ||
      chamada.motoristaAtual.socketId !== socket.id ||
      chamada.tokenTentativa !== dados.tokenTentativa
    ) {
      socket.emit("chamada_indisponivel", {
        idChamada: dados.idChamada,
        mensagem: "Essa chamada já foi enviada para outro mototaxista.",
      });
      return;
    }

    io.emit("chamada_recusada", dados);

    if (chamada.passageiroSocketId) {
      io.to(chamada.passageiroSocketId).emit("status_chamada", {
        status: "recusada",
        mensagem: `${dados.nomeMotorista} recusou. Tentando outro mototaxista...`,
      });
    }

    tentarProximoMotorista(dados.idChamada, "recusada");
  });

  socket.on("finalizar_corrida", (dados) => {
    console.log("Corrida finalizada:", dados);

    const chamada = chamadas.get(dados.idChamada);

    if (!chamada) {
      socket.emit("chamada_indisponivel", {
        idChamada: dados.idChamada,
        mensagem: "Essa chamada não está mais disponível.",
      });
      return;
    }

    if (
      chamada.status !== "aceita" ||
      !chamada.motoristaAceitou ||
      chamada.motoristaAceitou.socketId !== socket.id
    ) {
      socket.emit("chamada_indisponivel", {
        idChamada: dados.idChamada,
        mensagem: "Apenas o mototaxista que aceitou pode finalizar essa corrida.",
      });
      return;
    }

    limparTimeoutChamada(chamada);

    io.emit("corrida_finalizada", dados);

    if (chamada.passageiroSocketId) {
      io.to(chamada.passageiroSocketId).emit("corrida_finalizada_passageiro", {
        idChamada: dados.idChamada,
        nomeMotorista: dados.nomeMotorista,
        mensagem: "Corrida finalizada.",
      });
    }

    chamadas.delete(dados.idChamada);
  });

  socket.on("cancelar_corrida", (dados, callback) => {
    console.log("Solicitação de cancelamento de corrida:", dados);

    const chamada = chamadas.get(dados.idChamada);

    if (!chamada) {
      const resposta = {
        ok: false,
        mensagem: "Essa corrida não está mais disponível.",
      };

      socket.emit("chamada_indisponivel", {
        idChamada: dados.idChamada,
        mensagem: resposta.mensagem,
      });

      if (callback) callback(resposta);
      return;
    }

    if (chamada.status !== "aceita" || !chamada.motoristaAceitou) {
      const resposta = {
        ok: false,
        mensagem: "Essa corrida ainda não está aceita ou já foi encerrada.",
      };

      socket.emit("chamada_indisponivel", {
        idChamada: dados.idChamada,
        mensagem: resposta.mensagem,
      });

      if (callback) callback(resposta);
      return;
    }

    const canceladoPeloMotorista = chamada.motoristaAceitou.socketId === socket.id;
    const canceladoPeloPassageiro = chamada.passageiroSocketId === socket.id;

    if (!canceladoPeloMotorista && !canceladoPeloPassageiro) {
      const resposta = {
        ok: false,
        mensagem: "Você não tem permissão para cancelar essa corrida.",
      };

      socket.emit("chamada_indisponivel", {
        idChamada: dados.idChamada,
        mensagem: resposta.mensagem,
      });

      if (callback) callback(resposta);
      return;
    }

    limparTimeoutChamada(chamada);

    const mensagem =
      canceladoPeloMotorista
        ? "O mototaxista cancelou a corrida."
        : "O passageiro cancelou a corrida.";

    const dadosCancelamento = {
      idChamada: dados.idChamada,
      idMotorista: chamada.motoristaAceitou.idMotorista,
      nomeMotorista: chamada.motoristaAceitou.nomeMotorista,
      endereco: chamada.endereco,
      origemCancelamento: canceladoPeloMotorista ? "motorista" : "passageiro",
      mensagem,
    };

    io.emit("corrida_cancelada", dadosCancelamento);

    if (canceladoPeloMotorista && chamada.passageiroSocketId) {
      io.to(chamada.passageiroSocketId).emit(
        "corrida_cancelada_passageiro",
        dadosCancelamento
      );
    }

    if (canceladoPeloPassageiro && chamada.motoristaAceitou.socketId) {
      io.to(chamada.motoristaAceitou.socketId).emit(
        "corrida_cancelada_motorista",
        dadosCancelamento
      );
    }

    chamadas.delete(dados.idChamada);

    if (callback) {
      callback({
        ok: true,
        mensagem: canceladoPeloMotorista
          ? "Corrida cancelada por você. O passageiro foi avisado."
          : "Corrida cancelada por você. O mototaxista foi avisado.",
      });
    }
  });

  socket.on("disconnect", () => {
    const motorista = motoristas.get(socket.id);

    if (motorista) {
      console.log("Motorista desconectado:", motorista.nome);
    }

    motoristas.delete(socket.id);
    enviarListaMotoristas();
  });
});

app.get("/", (req, res) => {
  res.send("Backend Cornélio Move rodando.");
});

app.get("/motoristas", (req, res) => {
  res.json(Array.from(motoristas.values()));
});

app.get("/geoapify-uso", (req, res) => {
  atualizarContadorGeoapify();

  res.json({
    configurada: Boolean(GEOAPIFY_API_KEY),
    dia: geoapifyUso.dia,
    consultasHoje: geoapifyUso.consultas,
    limiteDiario: GEOAPIFY_DAILY_LIMIT,
    consultasRestantes: Math.max(0, GEOAPIFY_DAILY_LIMIT - geoapifyUso.consultas),
  });
});

app.post("/despachar-motorista", (req, res) => {
  const { socketId, cliente, endereco, distancia, tempo, origem } = req.body;

  if (!socketId) {
    return res.status(400).json({
      ok: false,
      mensagem: "Selecione um motorista.",
    });
  }

  if (!endereco) {
    return res.status(400).json({
      ok: false,
      mensagem: "Endereço é obrigatório.",
    });
  }

  const motorista = motoristas.get(socketId);

  if (!motorista) {
    return res.status(404).json({
      ok: false,
      mensagem: "Motorista não está mais online.",
    });
  }

  const idChamada = Date.now().toString();
  const tokenTentativa = `${idChamada}-painel-${Date.now()}`;

  const chamada = {
    idChamada,
    cliente: cliente || "Passageiro",
    endereco,
    distancia: distancia || "A calcular",
    tempo: tempo || "A calcular",
    origem: origem || "Despacho rápido",
    status: "tentando_motorista",
    tokenTentativa,
    timeoutId: null,
    motoristaAtual: {
      socketId: motorista.socketId,
      idMotorista: motorista.idMotorista,
      nome: motorista.nome,
    },
    motoristaDestino: {
      socketId: motorista.socketId,
      idMotorista: motorista.idMotorista,
      nome: motorista.nome,
    },
  };

  chamadas.set(idChamada, chamada);

  io.to(socketId).emit("nova_chamada", chamada);

  console.log("Chamada enviada para motorista específico:", chamada);

  res.json({
    ok: true,
    mensagem: `Chamada enviada para ${motorista.nome}.`,
    chamada,
  });
});

const PORTA = 3001;

server.listen(PORTA, () => {
  console.log(`Backend Cornélio Move rodando na porta ${PORTA}`);
});