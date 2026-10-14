const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["https://kaos-frontend-mocha.vercel.app", "http://localhost:5173"], 
    methods: ["GET", "POST"]
  }
});

function criarBaralho() {
  const cores = ['vermelho', 'azul', 'verde', 'amarelo'];
  const valores = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'bloqueio', 'inverter', '+2'];
  let baralho = [];

  cores.forEach(cor => {
    valores.forEach(valor => {
      baralho.push({ id: Math.random().toString(36).substring(2, 10), cor, valor });
      if (valor !== '0') baralho.push({ id: Math.random().toString(36).substring(2, 10), cor, valor });
    });
  });

  for (let i = 0; i < 4; i++) {
    baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: 'coringa' });
    baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: '+4' });
  }

  for (let i = baralho.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [baralho[i], baralho[j]] = [baralho[j], baralho[i]];
  }

  return baralho;
}

function garantirBaralho(sala, qtdNecessaria) {
  if (sala.baralho.length < qtdNecessaria) {
    if (sala.mesa.length > 1) {
      const topo = sala.mesa.pop(); 
      const cartasParaEmbaralhar = [...sala.mesa]; 
      for (let i = cartasParaEmbaralhar.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cartasParaEmbaralhar[i], cartasParaEmbaralhar[j]] = [cartasParaEmbaralhar[j], cartasParaEmbaralhar[i]];
      }
      sala.baralho = cartasParaEmbaralhar.concat(sala.baralho);
      sala.mesa = [topo];
      io.to(sala.id).emit('erro', '🔄 O monte acabou! As cartas da mesa foram reembaralhadas.');
    }
  }
}

function validarSequencia(cartas) {
  if (cartas.length === 1) return true;
  const mesmoValor = cartas.every(c => c.valor === cartas[0].valor);
  if (mesmoValor) return true;
  const todosSaoNumeros = cartas.every(c => !isNaN(c.valor));
  if (todosSaoNumeros) {
    const mesmaCor = cartas.every(c => c.cor === cartas[0].cor);
    if (mesmaCor) {
      const crescente = cartas.every((c, i) => i === 0 ? true : parseInt(c.valor) === parseInt(cartas[i - 1].valor) + 1);
      if (crescente) return true;
    }
  }
  return false;
}

const salas = {};

const obterInfoJogadores = (sala) => {
  return sala.jogadores.map(j => ({
    id: j.id, nome: j.nome, avatar: j.avatar, qtdCartas: j.mao ? j.mao.length : 0
  }));
};

// ==========================================
// MÁQUINA DE ESTADOS E SISTEMA DE BOT (IA)
// ==========================================

function emitirAtualizacao(sala) {
  sala.jogadores.forEach(jogador => {
    io.to(jogador.id).emit('estado_atualizado', {
      minhaMao: jogador.mao,
      cartaMesa: sala.mesa[sala.mesa.length - 1],
      turnoAtual: sala.jogadores[sala.turnoIndex].id,
      sentido: sala.sentido,
      comprouNestaRodada: sala.comprouNestaRodada,
      comprasAcumuladas: sala.comprasAcumuladas,
      infoJogadores: obterInfoJogadores(sala)
    });
  });

  // IA: Analisa se algum humano esqueceu de gritar KAOS para denunciar
  const humanoVulneravel = sala.jogadores.find(j => j.mao.length === 1 && !j.disseUno && !j.isBot);
  const algumBot = sala.jogadores.find(j => j.isBot);
  if (humanoVulneravel && algumBot) {
    setTimeout(() => {
      if (salas[sala.id] && salas[sala.id].status === 'jogando') {
        const alvoAindaVulneravel = salas[sala.id].jogadores.find(j => j.id === humanoVulneravel.id);
        if (alvoAindaVulneravel && alvoAindaVulneravel.mao.length === 1 && !alvoAindaVulneravel.disseUno) {
          efetuarKaos(salas[sala.id], algumBot); // Bot Dedo Duro!
        }
      }
    }, 1500); // Dá 1.5 segundos pro humano perceber antes de denunciar
  }

  agendarTurnoBot(sala);
}

function agendarTurnoBot(sala) {
  if (sala.status !== 'jogando') return;
  const jogadorAtual = sala.jogadores[sala.turnoIndex];
  if (!jogadorAtual || !jogadorAtual.isBot) return;

  if (sala.botTimer) clearTimeout(sala.botTimer);
  
  // O Bot "pensa" por 1.5 a 2.5 segundos
  const tempoPensamento = Math.floor(Math.random() * 1000) + 1500;
  sala.botTimer = setTimeout(() => executarTurnoBot(sala, jogadorAtual), tempoPensamento);
}

function executarTurnoBot(sala, bot) {
  if (sala.status !== 'jogando' || sala.jogadores[sala.turnoIndex].id !== bot.id) return;

  // Se o bot acabou de comprar, ele obrigatoriamente passa a vez
  if (sala.comprouNestaRodada) {
    efetuarPassagem(sala, bot);
    return;
  }

  const cartaMesa = sala.mesa[sala.mesa.length - 1];
  let cartasValidas = [];

  if (sala.comprasAcumuladas > 0) {
    cartasValidas = bot.mao.filter(c => c.valor === '+2' || c.valor === '+4');
  } else {
    cartasValidas = bot.mao.filter(c => c.cor === 'preto' || c.cor === cartaMesa.cor || c.valor === cartaMesa.valor);
  }

  if (cartasValidas.length > 0) {
    // IA Estratégica: Prioriza gastar cartas normais e guardar coringas pro fim
    cartasValidas.sort((a, b) => (a.cor === 'preto' ? 1 : -1));
    const escolhida = cartasValidas[0];
    
    // IA Combo: Se tiver cartas do mesmo valor, joga todas juntas para limpar a mão
    let combo = [escolhida];
    if (escolhida.cor !== 'preto' && escolhida.valor !== '+2') {
      const iguais = bot.mao.filter(c => c.valor === escolhida.valor && c.id !== escolhida.id && c.cor !== 'preto');
      combo = [escolhida, ...iguais];
    }

    // IA Escolha de Cor: Se for coringa, escolhe a cor que mais tem na mão
    let novaCor = null;
    if (escolhida.cor === 'preto') {
      const contagem = { 'vermelho': 0, 'azul': 0, 'verde': 0, 'amarelo': 0 };
      bot.mao.forEach(c => { if(contagem[c.cor] !== undefined) contagem[c.cor]++ });
      novaCor = Object.keys(contagem).reduce((a, b) => contagem[a] > contagem[b] ? a : b);
    }

    // IA Agressiva do Zero: Rouba as cartas de quem tiver a menor mão
    let alvoTroca = null;
    if (escolhida.valor === '0') {
      let oponentes = sala.jogadores.filter(j => j.id !== bot.id);
      oponentes.sort((a, b) => a.mao.length - b.mao.length);
      // Se o cara estiver ganhando de mim, eu roubo ele. Se eu estiver ganhando, passo (ninguem)
      alvoTroca = oponentes[0].mao.length < bot.mao.length ? oponentes[0].id : 'ninguem';
    }

    // IA Grita KAOS perfeitamente (não erra)
    if (bot.mao.length - combo.length > 0 && bot.mao.length - combo.length <= 2) {
      bot.disseUno = true;
      io.to(sala.id).emit('erro', `🗣️ ${bot.nome} GRITOU KAOS!`);
    }

    efetuarJogada(sala, bot, combo, novaCor, alvoTroca);
  } else {
    // Não tem nada, compra carta e programa passar a vez
    efetuarCompra(sala, bot);
  }
}

// ==========================================
// FUNÇÕES DE AÇÃO CORE (Usadas por Humanos e Bots)
// ==========================================

function efetuarJogada(sala, jogador, cartas, novaCor, alvoTroca) {
  if (!sala || sala.status !== 'jogando' || !jogador || sala.jogadores[sala.turnoIndex].id !== jogador.id) return;
  if (!cartas || cartas.length === 0) return;

  const cartaMesa = sala.mesa[sala.mesa.length - 1];
  const primeiraCarta = cartas[0];
  const isPrimeiraCoringa = primeiraCarta.cor === 'preto';
  const combinaComMesa = isPrimeiraCoringa || primeiraCarta.cor === cartaMesa.cor || primeiraCarta.valor === cartaMesa.valor;

  if (!combinaComMesa) return io.to(jogador.id).emit('erro', 'A primeira carta não combina com a mesa!');
  if (sala.comprasAcumuladas > 0 && primeiraCarta.valor !== '+2' && primeiraCarta.valor !== '+4') {
    return io.to(jogador.id).emit('erro', `Jogue um +2/+4 ou compre ${sala.comprasAcumuladas} cartas.`);
  }
  if (!validarSequencia(cartas)) return io.to(jogador.id).emit('erro', 'Sequência inválida!');

  cartas.forEach(cartaJogada => {
    const index = jogador.mao.findIndex(c => c.id === cartaJogada.id);
    if (index !== -1) jogador.mao.splice(index, 1);
    sala.mesa.push(cartaJogada);
  });

  const ultimaCartaJogada = sala.mesa[sala.mesa.length - 1];
  if (ultimaCartaJogada.cor === 'preto' && novaCor) ultimaCartaJogada.cor = novaCor;

  let pulos = 1;
  if (cartas[0].valor === 'inverter') {
    if (cartas.length % 2 !== 0) sala.sentido *= -1;
  } else if (cartas[0].valor === 'bloqueio') {
    pulos = cartas.length + 1; 
  }

  const temZero = cartas.some(c => c.valor === '0');
  if (temZero && alvoTroca) {
    if (alvoTroca === 'ninguem') {
      io.to(sala.id).emit('erro', `🙊 ${jogador.nome} decidiu manter suas cartas!`);
    } else if (alvoTroca === 'todos') {
      const maosAntigas = sala.jogadores.map(j => [...j.mao]);
      sala.jogadores.forEach((j, i) => {
        const idx = ((i - sala.sentido) % sala.jogadores.length + sala.jogadores.length) % sala.jogadores.length;
        j.mao = maosAntigas[idx];
      });
      io.to(sala.id).emit('erro', `🌪️ ${jogador.nome} girou as cartas da mesa!`);
    } else {
      const jogadorAlvo = sala.jogadores.find(j => j.id === alvoTroca);
      if (jogadorAlvo) {
        const maoTemp = [...jogador.mao];
        jogador.mao = [...jogadorAlvo.mao];
        jogadorAlvo.mao = maoTemp;
        io.to(sala.id).emit('erro', `🔄 ${jogador.nome} trocou as cartas com ${jogadorAlvo.nome}!`);
      }
    }
  }

  if (cartas[0].valor === '+2') sala.comprasAcumuladas += (2 * cartas.length);
  else if (cartas[0].valor === '+4') sala.comprasAcumuladas += (4 * cartas.length);

  // REGRA DO 9 (Dispara o evento para humanos e programa os bots)
  if (ultimaCartaJogada.valor === '9') {
    const qtdNoves = cartas.filter(c => c.valor === '9').length; 
    sala.eventoBateMesa = { ativo: true, jogadoresQueBateram: [], punicao: qtdNoves };
    io.to(sala.id).emit('iniciar_evento_nove');
    
    sala.jogadores.forEach(j => {
      if (j.isBot) {
        // Bots batem na mesa entre 1 e 3.5 segundos! Fique atento!
        const reflexoBot = Math.floor(Math.random() * 2500) + 1000;
        setTimeout(() => efetuarBaterMesa(sala, j), reflexoBot);
      }
    });
  }

  sala.turnoIndex = ((sala.turnoIndex + (pulos * sala.sentido)) % sala.jogadores.length + sala.jogadores.length) % sala.jogadores.length;
  sala.comprouNestaRodada = false;

  if (jogador.mao.length === 0) {
    sala.status = 'finalizado';
    if(sala.botTimer) clearTimeout(sala.botTimer);
    return io.to(sala.id).emit('fim_de_jogo', jogador.nome);
  }

  emitirAtualizacao(sala);
}

function efetuarCompra(sala, jogador) {
  if (!sala || sala.status !== 'jogando' || !jogador || sala.jogadores[sala.turnoIndex].id !== jogador.id || sala.comprouNestaRodada) return;
  
  const qtdParaComprar = sala.comprasAcumuladas > 0 ? sala.comprasAcumuladas : 1;
  garantirBaralho(sala, qtdParaComprar);

  for (let i = 0; i < qtdParaComprar; i++) {
    if (sala.baralho.length > 0) jogador.mao.push(sala.baralho.pop());
  }
  jogador.disseUno = false;

  if (sala.comprasAcumuladas > 0) {
    sala.comprasAcumuladas = 0;
    sala.turnoIndex = ((sala.turnoIndex + sala.sentido) % sala.jogadores.length + sala.jogadores.length) % sala.jogadores.length;
  } else {
    sala.comprouNestaRodada = true;
  }
  emitirAtualizacao(sala);
}

function efetuarPassagem(sala, jogador) {
  if (!sala || sala.status !== 'jogando' || !jogador || sala.jogadores[sala.turnoIndex].id !== jogador.id || !sala.comprouNestaRodada) return;
  sala.turnoIndex = ((sala.turnoIndex + sala.sentido) % sala.jogadores.length + sala.jogadores.length) % sala.jogadores.length;
  sala.comprouNestaRodada = false;
  emitirAtualizacao(sala);
}

function efetuarBaterMesa(sala, jogador) {
  if (!sala || !sala.eventoBateMesa || !sala.eventoBateMesa.ativo) return;
  if (sala.eventoBateMesa.jogadoresQueBateram.includes(jogador.id)) return;

  sala.eventoBateMesa.jogadoresQueBateram.push(jogador.id);
  const bateram = sala.eventoBateMesa.jogadoresQueBateram.length;

  if (bateram === sala.jogadores.length - 1) {
    const lerdinho = sala.jogadores.find(j => !sala.eventoBateMesa.jogadoresQueBateram.includes(j.id));
    if (lerdinho) {
      garantirBaralho(sala, sala.eventoBateMesa.punicao);
      for (let i = 0; i < sala.eventoBateMesa.punicao; i++) {
        if (sala.baralho.length > 0) lerdinho.mao.push(sala.baralho.pop());
      }
      sala.eventoBateMesa.ativo = false;
      io.to(sala.id).emit('fim_evento_nove', { perdedor: lerdinho.nome, cartasCompradas: sala.eventoBateMesa.punicao });
      emitirAtualizacao(sala);
    }
  }
}

function efetuarKaos(sala, denunciante) {
  if (!sala || sala.status !== 'jogando' || !denunciante) return;
  let denunciouAlguem = false;
  let nomeInfrator = '';
  
  sala.jogadores.forEach(j => {
    if (j.mao.length === 1 && !j.disseUno && j.id !== denunciante.id) {
      garantirBaralho(sala, 1);
      if (sala.baralho.length > 0) j.mao.push(sala.baralho.pop());
      denunciouAlguem = true;
      nomeInfrator = j.nome;
    }
  });

  if (denunciouAlguem) {
    io.to(sala.id).emit('erro', `🚨 O jogador ${nomeInfrator} esqueceu de gritar KAOS e comprou 1 carta!`);
    emitirAtualizacao(sala);
    return; 
  }

  if (denunciante.mao.length <= 2) {
    denunciante.disseUno = true;
    io.to(sala.id).emit('erro', `🗣️ ${denunciante.nome} GRITOU KAOS!`);
  } else {
    io.to(denunciante.id).emit('erro', `Ninguém para denunciar!`);
  }
}

// ==========================================
// CONEXÃO DE SOCKETS (Rotas)
// ==========================================

io.on('connection', (socket) => {
  console.log(`🟢 Um jogador se conectou! ID: ${socket.id}`);

  const removerJogador = (socketId) => {
    for (const codigoSala in salas) {
      const sala = salas[codigoSala];
      const index = sala.jogadores.findIndex(j => j.id === socketId);
      
      if (index !== -1) {
        const nomeRemovido = sala.jogadores[index].nome;
        sala.jogadores.splice(index, 1);
        
        // Se a sala ficar vazia, ou só sobrar Bots na sala, destroi a sala
        if (sala.jogadores.length === 0 || sala.jogadores.every(j => j.isBot)) {
          if (sala.botTimer) clearTimeout(sala.botTimer);
          delete salas[codigoSala]; 
        } else {
          if (sala.status === 'jogando') {
            io.to(codigoSala).emit('erro', `⚠️ ${nomeRemovido} saiu da partida!`);
            if (index < sala.turnoIndex) sala.turnoIndex -= 1; 
            else if (index === sala.turnoIndex && sala.sentido === -1) sala.turnoIndex -= 1;
            
            if (sala.turnoIndex >= sala.jogadores.length || sala.turnoIndex < 0) sala.turnoIndex = 0;
            emitirAtualizacao(sala);
          } else {
            io.to(codigoSala).emit('atualizar_jogadores', obterInfoJogadores(sala));
          }
        }
        break; 
      }
    }
  };

  socket.on('criar_sala', ({ nomeJogador, avatar }) => {
    const codigoSala = Math.floor(1000 + Math.random() * 9000).toString();
    salas[codigoSala] = { id: codigoSala, status: 'esperando', jogadores: [{ id: socket.id, nome: nomeJogador, avatar, isBot: false }] };
    socket.join(codigoSala);
    socket.emit('sala_criada', codigoSala);
  });

  socket.on('entrar_sala', ({ codigoSala, nomeJogador, avatar }) => {
    const sala = salas[codigoSala];
    if (sala) {
      if (sala.status === 'jogando') return socket.emit('erro', 'A partida já começou!');
      if (sala.jogadores.length >= 6) return socket.emit('erro', 'A sala está cheia.');
      
      sala.jogadores.push({ id: socket.id, nome: nomeJogador, avatar, isBot: false });
      socket.join(codigoSala);
      io.to(codigoSala).emit('atualizar_jogadores', obterInfoJogadores(sala));
      socket.emit('entrou_na_sala', codigoSala);
    } else {
      socket.emit('erro', 'Código da sala não encontrado!');
    }
  });

  socket.on('iniciar_partida', (codigoSala) => {
    const sala = salas[codigoSala];
    if (sala && sala.jogadores[0].id === socket.id) {
      
      // === PREENCHIMENTO AUTOMÁTICO DE BOTS ===
      if (sala.jogadores.length === 1) {
        const nomesBots = [
          { nome: '🤖 T-800', avatar: 't800' },
          { nome: '🤖 GLaDOS', avatar: 'glados' },
          { nome: '🤖 HAL 9000', avatar: 'hal9000' }
        ];
        nomesBots.forEach((b, i) => {
          sala.jogadores.push({
            id: `bot_${Date.now()}_${i}`, nome: b.nome, avatar: b.avatar, isBot: true, mao: [], disseUno: false
          });
        });
        io.to(codigoSala).emit('atualizar_jogadores', obterInfoJogadores(sala));
      }

      sala.status = 'jogando';
      sala.baralho = criarBaralho();
      sala.mesa = [];

      sala.jogadores.forEach(jogador => {
        jogador.mao = sala.baralho.splice(0, 7);
        jogador.disseUno = false; 
      });

      const indexCartaValida = sala.baralho.findIndex(c => !isNaN(c.valor) && c.cor !== 'preto');
      let cartaTopo = sala.baralho.splice(indexCartaValida, 1)[0];
      
      sala.mesa.push(cartaTopo);
      sala.turnoIndex = 0;
      sala.sentido = 1;
      sala.comprouNestaRodada = false;
      sala.comprasAcumuladas = 0;
      sala.eventoBateMesa = { ativo: false, jogadoresQueBateram: [], punicao: 0 };

      sala.jogadores.forEach(jogador => {
        if (!jogador.isBot) {
          io.to(jogador.id).emit('partida_iniciada', {
            minhaMao: jogador.mao,
            cartaMesa: cartaTopo,
            turnoAtual: sala.jogadores[sala.turnoIndex].id,
            sentido: sala.sentido,
            comprouNestaRodada: sala.comprouNestaRodada,
            comprasAcumuladas: sala.comprasAcumuladas,
            infoJogadores: obterInfoJogadores(sala)
          });
        }
      });
      // Inicia a verificação pra ver se o primeiro turno já é de um bot
      agendarTurnoBot(sala);
    }
  });

  socket.on('jogar_cartas', (dados) => {
    const sala = salas[dados.codigoSala];
    const jogador = sala?.jogadores.find(j => j.id === socket.id);
    efetuarJogada(sala, jogador, dados.cartas, dados.novaCor, dados.alvoTroca);
  });

  socket.on('apertar_uno', (codigoSala) => {
    const sala = salas[codigoSala];
    const jogador = sala?.jogadores.find(j => j.id === socket.id);
    efetuarKaos(sala, jogador);
  });

  socket.on('comprar_carta', (codigoSala) => {
    const sala = salas[codigoSala];
    const jogador = sala?.jogadores.find(j => j.id === socket.id);
    efetuarCompra(sala, jogador);
  });

  socket.on('passar_vez', (codigoSala) => {
    const sala = salas[codigoSala];
    const jogador = sala?.jogadores.find(j => j.id === socket.id);
    efetuarPassagem(sala, jogador);
  });

  socket.on('bater_mesa', (codigoSala) => {
    const sala = salas[codigoSala];
    const jogador = sala?.jogadores.find(j => j.id === socket.id);
    if (jogador) efetuarBaterMesa(sala, jogador);
  });

  socket.on('sair_sala', (codigoSala) => {
    socket.leave(codigoSala);
    removerJogador(socket.id);
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Jogador desconectado: ${socket.id}`);
    removerJogador(socket.id);
  });
});

const porta = process.env.PORT || 3001;
server.listen(porta, () => {
  console.log(`Servidor rodando na porta ${porta}!`);
});