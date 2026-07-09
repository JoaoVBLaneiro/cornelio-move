const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

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
const sessoesMotoristas = new Map();

const TEMPO_RESPOSTA_MOTORISTA_MS = 15000;

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || "";
const GEOAPIFY_DAILY_LIMIT = Number(process.env.GEOAPIFY_DAILY_LIMIT || 2500);
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";

const DATA_DIR = path.join(__dirname, "data");
const MOTORISTAS_DB_PATH = path.join(DATA_DIR, "motoristas.json");

const geoapifyUso = {
  dia: null,
  consultas: 0,
};

function garantirBancoMotoristas() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(MOTORISTAS_DB_PATH)) {
    fs.writeFileSync(MOTORISTAS_DB_PATH, JSON.stringify({ motoristas: [] }, null, 2));
  }
}

function carregarBancoMotoristas() {
  garantirBancoMotoristas();

  try {
    const conteudo = fs.readFileSync(MOTORISTAS_DB_PATH, "utf8");
    const dados = JSON.parse(conteudo);

    if (!Array.isArray(dados.motoristas)) {
      return { motoristas: [] };
    }

    return dados;
  } catch (error) {
    console.log("Erro ao carregar banco de motoristas:", error.message);
    return { motoristas: [] };
  }
}

function salvarBancoMotoristas(dados) {
  garantirBancoMotoristas();
  fs.writeFileSync(MOTORISTAS_DB_PATH, JSON.stringify(dados, null, 2));
}

function validarLoginMotorista(login) {
  return /^\d{1,3}$/.test(String(login || "").trim());
}

function limparMotoristaParaResposta(motorista) {
  return {
    login: motorista.login,
    nome: motorista.nome,
    ativo: Boolean(motorista.ativo),
    criadoEm: motorista.criadoEm,
    atualizadoEm: motorista.atualizadoEm,
  };
}

function buscarMotoristaPorLogin(login) {
  const banco = carregarBancoMotoristas();
  return banco.motoristas.find((motorista) => motorista.login === String(login).trim()) || null;
}

function validarAdminSecret(valor) {
  if (!ADMIN_SECRET) {
    return false;
  }

  return String(valor || "") === ADMIN_SECRET;
}

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


async function obterCoordenadasPorEndereco(enderecoDigitado) {
  const enderecoLimpo = String(enderecoDigitado || "").trim();

  if (!enderecoLimpo) {
    return null;
  }

  if (!podeConsultarGeoapify()) {
    return null;
  }

  geoapifyUso.consultas += 1;

  const textoBusca = /corn[eé]lio|proc[oó]pio/i.test(enderecoLimpo)
    ? enderecoLimpo
    : `${enderecoLimpo}, Cornélio Procópio, Paraná, Brasil`;

  const params = new URLSearchParams({
    text: textoBusca,
    lang: "pt",
    format: "json",
    limit: "1",
    filter: "countrycode:br",
    bias: "proximity:-50.6467,-23.1818",
    apiKey: GEOAPIFY_API_KEY,
  });

  const url = `https://api.geoapify.com/v1/geocode/search?${params.toString()}`;

  try {
    const resposta = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!resposta.ok) {
      console.log("Erro na Geoapify ao buscar endereço:", {
        status: resposta.status,
        statusText: resposta.statusText,
      });
      return null;
    }

    const dados = await resposta.json();
    const resultado = Array.isArray(dados.results) ? dados.results[0] : null;

    if (!resultado) {
      console.log("Geoapify não encontrou coordenadas para o endereço:", enderecoLimpo);
      return null;
    }

    const latitude = Number(resultado.lat);
    const longitude = Number(resultado.lon);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      console.log("Geoapify retornou coordenadas inválidas:", resultado);
      return null;
    }

    const enderecoFormatado = montarEnderecoGeoapify(resultado) || enderecoLimpo;

    console.log("Endereço convertido pela Geoapify:", {
      enderecoDigitado: enderecoLimpo,
      enderecoFormatado,
      latitude,
      longitude,
      consultasHoje: geoapifyUso.consultas,
      limiteDiario: GEOAPIFY_DAILY_LIMIT,
    });

    return {
      latitude,
      longitude,
      enderecoFormatado,
    };
  } catch (error) {
    console.log("Falha ao consultar Geoapify para endereço digitado:", error.message);
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
    .filter((motorista) => motorista.online && motorista.statusOperacional === "disponivel")
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

function marcarMotoristaDisponivel(socketId) {
  const motorista = motoristas.get(socketId);

  if (!motorista) {
    return;
  }

  motorista.statusOperacional = "disponivel";
  motorista.chamadaAtualId = null;
  motorista.atualizadoEm = new Date();

  motoristas.set(socketId, motorista);
  enviarListaMotoristas();
}

function marcarMotoristaTocando(socketId, idChamada) {
  const motorista = motoristas.get(socketId);

  if (!motorista) {
    return;
  }

  motorista.statusOperacional = "tocando";
  motorista.chamadaAtualId = idChamada;
  motorista.atualizadoEm = new Date();

  motoristas.set(socketId, motorista);
  enviarListaMotoristas();
}

function marcarMotoristaOcupado(socketId, idChamada) {
  const motorista = motoristas.get(socketId);

  if (!motorista) {
    return;
  }

  motorista.statusOperacional = "ocupado";
  motorista.chamadaAtualId = idChamada;
  motorista.atualizadoEm = new Date();

  motoristas.set(socketId, motorista);
  enviarListaMotoristas();
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

  if (chamada.status === "tentando_motorista" && chamada.motoristaAtual) {
    if (motivo !== "recusada") {
      io.to(chamada.motoristaAtual.socketId).emit("cancelar_chamada", {
        idChamada,
        mensagem: "Essa chamada foi enviada para outro mototaxista.",
      });
    }

    marcarMotoristaDisponivel(chamada.motoristaAtual.socketId);
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

    chamadas.delete(idChamada);
    return;
  }

  const motorista = chamada.motoristasOrdenados[chamada.indiceAtual];

  const motoristaAtualizado = motoristas.get(motorista.socketId);

  if (!motoristaAtualizado) {
    console.log("Motorista saiu antes da tentativa:", motorista.nome);
    tentarProximoMotorista(idChamada, "motorista_offline");
    return;
  }

  if (motoristaAtualizado.statusOperacional !== "disponivel") {
    console.log("Motorista não está disponível para tentativa:", {
      nome: motoristaAtualizado.nome,
      statusOperacional: motoristaAtualizado.statusOperacional,
    });
    tentarProximoMotorista(idChamada, "motorista_indisponivel");
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
  marcarMotoristaTocando(motorista.socketId, idChamada);

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

  socket.on("motorista_online", (dados, callback) => {
    const tokenSessao = String(dados.tokenSessao || "");
    const sessao = sessoesMotoristas.get(tokenSessao);

    if (!sessao) {
      const resposta = {
        ok: false,
        mensagem: "Faça login novamente para ficar online.",
      };

      socket.emit("auth_erro", resposta);
      if (callback) callback(resposta);
      return;
    }

    const motoristaConta = buscarMotoristaPorLogin(sessao.login);

    if (!motoristaConta || !motoristaConta.ativo) {
      const resposta = {
        ok: false,
        mensagem: "Conta de motorista inativa ou não encontrada.",
      };

      socket.emit("auth_erro", resposta);
      if (callback) callback(resposta);
      return;
    }

    motoristas.set(socket.id, {
      socketId: socket.id,
      idMotorista: motoristaConta.login,
      nome: motoristaConta.nome,
      latitude: dados.latitude,
      longitude: dados.longitude,
      online: true,
      statusOperacional: "disponivel",
      chamadaAtualId: null,
      modoLocalizacao: "economico",
      atualizadoEm: new Date(),
      tokenSessao,
    });

    console.log("Motorista online:", {
      login: motoristaConta.login,
      nome: motoristaConta.nome,
    });
    enviarListaMotoristas();

    if (callback) {
      callback({
        ok: true,
        motorista: {
          login: motoristaConta.login,
          nome: motoristaConta.nome,
        },
      });
    }
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
        mensagem: "Nenhum mototaxista disponível no momento.",
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

    const motoristaLogado = motoristas.get(socket.id);

    if (!motoristaLogado) {
      const resposta = {
        ok: false,
        mensagem: "Faça login e fique online novamente para aceitar chamadas.",
      };

      socket.emit("chamada_indisponivel", {
        idChamada: dados.idChamada,
        mensagem: resposta.mensagem,
      });

      if (callback) callback(resposta);
      return;
    }

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
      idMotorista: motoristaLogado.idMotorista,
      nomeMotorista: motoristaLogado.nome,
    };

    chamadas.set(dados.idChamada, chamada);
    marcarMotoristaOcupado(socket.id, dados.idChamada);

    const dadosAceite = {
      ...dados,
      idMotorista: motoristaLogado.idMotorista,
      nomeMotorista: motoristaLogado.nome,
      endereco: chamada.endereco,
    };

    console.log("Chamada aceita:", dadosAceite);

    io.emit("chamada_aceita", dadosAceite);

    if (chamada.passageiroSocketId) {
      io.to(chamada.passageiroSocketId).emit("chamada_aceita_passageiro", {
        idChamada: dados.idChamada,
        nomeMotorista: motoristaLogado.nome,
        idMotorista: motoristaLogado.idMotorista,
        endereco: chamada.endereco,
        mensagem: `${motoristaLogado.nome} aceitou sua chamada.`,
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

    const motoristaLogado = motoristas.get(socket.id);
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

    const dadosRecusa = {
      ...dados,
      idMotorista: motoristaLogado?.idMotorista || dados.idMotorista,
      nomeMotorista: motoristaLogado?.nome || dados.nomeMotorista,
      endereco: chamada.endereco,
    };

    marcarMotoristaDisponivel(socket.id);

    io.emit("chamada_recusada", dadosRecusa);

    if (chamada.passageiroSocketId) {
      io.to(chamada.passageiroSocketId).emit("status_chamada", {
        status: "recusada",
        mensagem: `${dadosRecusa.nomeMotorista} recusou. Tentando outro mototaxista...`,
      });
    }

    tentarProximoMotorista(dados.idChamada, "recusada");
  });

  socket.on("finalizar_corrida", (dados) => {
    console.log("Corrida finalizada:", dados);

    const motoristaLogado = motoristas.get(socket.id);
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

    const dadosFinalizacao = {
      ...dados,
      idMotorista: chamada.motoristaAceitou.idMotorista,
      nomeMotorista: chamada.motoristaAceitou.nomeMotorista || motoristaLogado?.nome,
      endereco: chamada.endereco,
    };

    marcarMotoristaDisponivel(chamada.motoristaAceitou.socketId);

    io.emit("corrida_finalizada", dadosFinalizacao);

    if (chamada.passageiroSocketId) {
      io.to(chamada.passageiroSocketId).emit("corrida_finalizada_passageiro", {
        idChamada: dados.idChamada,
        nomeMotorista: dadosFinalizacao.nomeMotorista,
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

    marcarMotoristaDisponivel(chamada.motoristaAceitou.socketId);

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

app.get("/admin/motoristas", (req, res) => {
  const secret = req.query.secret;

  if (!validarAdminSecret(secret)) {
    return res.status(401).json({
      ok: false,
      mensagem: "Senha administrativa inválida.",
    });
  }

  const banco = carregarBancoMotoristas();

  res.json({
    ok: true,
    motoristas: banco.motoristas.map(limparMotoristaParaResposta),
  });
});

app.post("/admin/motoristas", async (req, res) => {
  const { secret, login, nome, senha, ativo } = req.body;

  if (!validarAdminSecret(secret)) {
    return res.status(401).json({
      ok: false,
      mensagem: "Senha administrativa inválida.",
    });
  }

  const loginLimpo = String(login || "").trim();
  const nomeLimpo = String(nome || "").trim();
  const senhaLimpa = String(senha || "");

  if (!validarLoginMotorista(loginLimpo)) {
    return res.status(400).json({
      ok: false,
      mensagem: "O login deve ter apenas números e entre 1 e 3 dígitos.",
    });
  }

  if (!nomeLimpo) {
    return res.status(400).json({
      ok: false,
      mensagem: "Informe o nome do motorista.",
    });
  }

  const banco = carregarBancoMotoristas();
  const indiceExistente = banco.motoristas.findIndex(
    (motorista) => motorista.login === loginLimpo
  );

  const agora = new Date().toISOString();

  if (indiceExistente >= 0) {
    const motoristaAtual = banco.motoristas[indiceExistente];

    motoristaAtual.nome = nomeLimpo;
    motoristaAtual.ativo = ativo !== false;
    motoristaAtual.atualizadoEm = agora;

    if (senhaLimpa) {
      if (senhaLimpa.length < 4) {
        return res.status(400).json({
          ok: false,
          mensagem: "A senha deve ter pelo menos 4 caracteres.",
        });
      }

      motoristaAtual.senhaHash = await bcrypt.hash(senhaLimpa, 10);
    }

    banco.motoristas[indiceExistente] = motoristaAtual;
    salvarBancoMotoristas(banco);

    return res.json({
      ok: true,
      mensagem: "Motorista atualizado com sucesso.",
      motorista: limparMotoristaParaResposta(motoristaAtual),
    });
  }

  if (senhaLimpa.length < 4) {
    return res.status(400).json({
      ok: false,
      mensagem: "Para criar motorista, informe uma senha com pelo menos 4 caracteres.",
    });
  }

  const novoMotorista = {
    login: loginLimpo,
    nome: nomeLimpo,
    senhaHash: await bcrypt.hash(senhaLimpa, 10),
    ativo: ativo !== false,
    criadoEm: agora,
    atualizadoEm: agora,
  };

  banco.motoristas.push(novoMotorista);
  salvarBancoMotoristas(banco);

  return res.json({
    ok: true,
    mensagem: "Motorista criado com sucesso.",
    motorista: limparMotoristaParaResposta(novoMotorista),
  });
});

app.post("/auth/login-motorista", async (req, res) => {
  const login = String(req.body.login || "").trim();
  const senha = String(req.body.senha || "");

  if (!validarLoginMotorista(login)) {
    return res.status(400).json({
      ok: false,
      mensagem: "Login inválido.",
    });
  }

  if (!senha) {
    return res.status(400).json({
      ok: false,
      mensagem: "Informe a senha.",
    });
  }

  const motorista = buscarMotoristaPorLogin(login);

  if (!motorista || !motorista.ativo) {
    return res.status(401).json({
      ok: false,
      mensagem: "Login ou senha inválidos.",
    });
  }

  const senhaCorreta = await bcrypt.compare(senha, motorista.senhaHash);

  if (!senhaCorreta) {
    return res.status(401).json({
      ok: false,
      mensagem: "Login ou senha inválidos.",
    });
  }

  const tokenSessao = crypto.randomBytes(32).toString("hex");

  sessoesMotoristas.set(tokenSessao, {
    login: motorista.login,
    nome: motorista.nome,
    criadoEm: new Date(),
  });

  return res.json({
    ok: true,
    tokenSessao,
    motorista: {
      login: motorista.login,
      nome: motorista.nome,
    },
  });
});


app.post("/admin/despacho-rapido", async (req, res) => {
  const { secret, cliente, endereco, observacao } = req.body;

  if (!validarAdminSecret(secret)) {
    return res.status(401).json({
      ok: false,
      mensagem: "Senha administrativa inválida.",
    });
  }

  const enderecoDigitado = String(endereco || "").trim();

  if (!enderecoDigitado) {
    return res.status(400).json({
      ok: false,
      mensagem: "Informe o endereço de embarque.",
    });
  }

  const coordenadas = await obterCoordenadasPorEndereco(enderecoDigitado);

  if (!coordenadas) {
    return res.status(400).json({
      ok: false,
      mensagem: "Não foi possível encontrar esse endereço. Tente informar rua, número, bairro e cidade.",
    });
  }

  const motoristasOrdenados = listarMotoristasPorProximidade(
    coordenadas.latitude,
    coordenadas.longitude
  );

  if (motoristasOrdenados.length === 0) {
    return res.status(400).json({
      ok: false,
      mensagem: "Nenhum mototaxista disponível no momento.",
    });
  }

  const idChamada = Date.now().toString();

  const chamada = {
    idChamada,
    cliente: String(cliente || "").trim() || "Passageiro do despacho rápido",
    endereco: coordenadas.enderecoFormatado || enderecoDigitado,
    observacao: String(observacao || "").trim() || "Despacho rápido pela central",
    latitudePassageiro: coordenadas.latitude,
    longitudePassageiro: coordenadas.longitude,
    origem: "Despacho rápido",
    passageiroSocketId: null,
    motoristasOrdenados,
    indiceAtual: -1,
    status: "criada",
    timeoutId: null,
    criadoPorAdmin: true,
    enderecoDigitado,
  };

  chamadas.set(idChamada, chamada);

  tentarProximoMotorista(idChamada, "despacho_rapido_admin");

  return res.json({
    ok: true,
    mensagem: `Despacho criado. Tentando ${motoristasOrdenados[0].nome}.`,
    idChamada,
    endereco: chamada.endereco,
    coordenadas: {
      latitude: coordenadas.latitude,
      longitude: coordenadas.longitude,
    },
    motoristasDisponiveis: motoristasOrdenados.length,
    primeiroMotorista: {
      idMotorista: motoristasOrdenados[0].idMotorista,
      nome: motoristasOrdenados[0].nome,
      distancia: formatarDistancia(motoristasOrdenados[0].distanciaMetros),
      tempo: estimarTempo(motoristasOrdenados[0].distanciaMetros),
    },
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

  if (motorista.statusOperacional !== "disponivel") {
    return res.status(400).json({
      ok: false,
      mensagem: `Motorista não está disponível no momento. Status: ${motorista.statusOperacional}.`,
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
  marcarMotoristaTocando(socketId, idChamada);

  io.to(socketId).emit("nova_chamada", chamada);

  console.log("Chamada enviada para motorista específico:", chamada);

  res.json({
    ok: true,
    mensagem: `Chamada enviada para ${motorista.nome}.`,
    chamada,
  });
});

const PORTA = 3001;

garantirBancoMotoristas();

server.listen(PORTA, () => {
  console.log(`Backend Cornélio Move rodando na porta ${PORTA}`);
});