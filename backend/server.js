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

const TEMPO_RESPOSTA_MOTORISTA_MS = 25000;

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

  chamada.status = "tentando_motorista";
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

    if (!chamadaAtual || chamadaAtual.status !== "tentando_motorista") {
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

  socket.on("passageiro_chamar", (dados) => {
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

    const idChamada = Date.now().toString();

    const chamada = {
      idChamada,
      cliente: dados.nome || "Passageiro do app",
      endereco: "Localização atual do passageiro",
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

  socket.on("aceitar_chamada", (dados) => {
    console.log("Chamada aceita:", dados);

    const chamada = chamadas.get(dados.idChamada);

    if (chamada) {
      limparTimeoutChamada(chamada);
      chamada.status = "aceita";
      chamadas.set(dados.idChamada, chamada);
    }

    io.emit("chamada_aceita", dados);

    if (chamada && chamada.passageiroSocketId) {
      io.to(chamada.passageiroSocketId).emit("chamada_aceita_passageiro", {
        idChamada: dados.idChamada,
        nomeMotorista: dados.nomeMotorista,
        idMotorista: dados.idMotorista,
        endereco: dados.endereco,
        mensagem: `${dados.nomeMotorista} aceitou sua chamada.`,
      });
    }
  });

  socket.on("recusar_chamada", (dados) => {
    console.log("Chamada recusada:", dados);

    const chamada = chamadas.get(dados.idChamada);

    io.emit("chamada_recusada", dados);

    if (chamada && chamada.passageiroSocketId) {
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

    if (chamada) {
      limparTimeoutChamada(chamada);
    }

    io.emit("corrida_finalizada", dados);

    if (chamada && chamada.passageiroSocketId) {
      io.to(chamada.passageiroSocketId).emit("corrida_finalizada_passageiro", {
        idChamada: dados.idChamada,
        nomeMotorista: dados.nomeMotorista,
        mensagem: "Corrida finalizada.",
      });
    }

    chamadas.delete(dados.idChamada);
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

  const chamada = {
    idChamada,
    cliente: cliente || "Passageiro",
    endereco,
    distancia: distancia || "A calcular",
    tempo: tempo || "A calcular",
    origem: origem || "Despacho rápido",
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