const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["https://kaos-card-game.vercel.app", "http://localhost:5173"], 
    methods: ["GET", "POST"]
  }
});

function criarBaralho() {
  const cores = ['vermelho', 'azul', 'verde', 'amarelo'];
  // 'espiar' removido das normais, agora é especial (preta)
  const valoresNormais = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'bloqueio', 'inverter', '+2', '+3'];
  let baralho = [];

  // Criar Cartas Normais
  cores.forEach(cor => {
    valoresNormais.forEach(valor => {
      baralho.push({ id: Math.random().toString(36).substring(2, 10), cor, valor, originalCor: cor, originalValor: valor });
      if (valor !== '0') baralho.push({ id: Math.random().toString(36).substring(2, 10), cor, valor, originalCor: cor, originalValor: valor });
    });
  });

  // Criar Cartas Pretas Especiais
  for (let i = 0; i < 4; i++) {
    baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: 'coringa', originalCor: 'preto', originalValor: 'coringa' });
    baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: '+4', originalCor: 'preto', originalValor: '+4' });
  }
  for (let i = 0; i < 2; i++) {
    baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: '+6', originalCor: 'preto', originalValor: '+6' });
    baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: 'igualar', originalCor: 'preto', originalValor: 'igualar' });
    baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: 'reinicio', originalCor: 'preto', originalValor: 'reinicio' });
    baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: 'escolher_numero', originalCor: 'preto', originalValor: 'escolher_numero' });
    baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: 'espiar', originalCor: 'preto', originalValor: 'espiar' });
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
      let cartasParaEmbaralhar = [...sala.mesa]; 
      
      for (let i = cartasParaEmbaralhar.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cartasParaEmbaralhar[i], cartasParaEmbaralhar[j]] = [cartasParaEmbaralhar[j], cartasParaEmbaralhar[i]];
      }

      // CORREÇÃO MUTAÇÃO: Restaurar cor e valor originais antes de voltar pro baralho
      cartasParaEmbaralhar = cartasParaEmbaralhar.map(c => ({
        ...c,
        cor: c.originalCor,
        valor: c.originalValor
      }));

      sala.baralho = cartasParaEmbaralhar.concat(sala.baralho);
      sala.mesa = [topo];
      io.to(sala.id).emit('erro', 'Aviso: O monte acabou! As cartas da mesa foram reembaralhadas.');
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
      const decrescente = cartas.every((c, i) => i === 0 ? true : parseInt(c.valor) === parseInt(cartas[i - 1].valor) - 1);
      if (crescente || decrescente) return true;
    }
  }
  return false;
}

const salas = {};

const obterInfoJogadores = (sala) => {
  return sala.jogadores.map(j => ({
    id: j.id, nome: j.nome, avatar: j.avatar, qtdCartas: j.mao ? j.mao.length : 0, vitorias: j.vitorias || 0
  }));
};

function emitirAtualizacao(sala, resetarTempo = true) {
  sala.jogadores.forEach(jogador => {
    io.to(jogador.id).emit('estado_atualizado', {
      minhaMao: jogador.mao,
      cartaMesa: sala.mesa[sala.mesa.length - 1],
      turnoAtual: sala.jogadores[sala.turnoIndex].id,
      sentido: sala.sentido,
      comprouNestaRodada: sala.comprouNestaRodada,
      comprasAcumuladas: sala.comprasAcumuladas,
      infoJogadores: obterInfoJogadores(sala),
      resetarTempo: resetarTempo
    });
  });

  const humanoVulneravel = sala.jogadores.find(j => j.mao.length === 1 && !j.disseUno && !j.isBot);
  const algumBot = sala.jogadores.find(j => j.isBot);
  if (humanoVulneravel && algumBot) {
    setTimeout(() => {
      if (salas[sala.id] && salas[sala.id].status === 'jogando') {
        const alvoAindaVulneravel = salas[sala.id].jogadores.find(j => j.id === humanoVulneravel.id);
        if (alvoAindaVulneravel && alvoAindaVulneravel.mao.length === 1 && !alvoAindaVulneravel.disseUno) {
          efetuarKaos(salas[sala.id], algumBot); 
        }
      }
    }, 1500); 
  }

  if (sala.botTimer) clearTimeout(sala.botTimer);
  agendarTurnoBot(sala);

  if (resetarTempo) {
    if (sala.turnoTimer) clearTimeout(sala.turnoTimer);
    if (!sala.eventoBateMesa?.ativo) agendarTurnoSeguranca(sala);
  }
}

function estourarTempo(sala, jogador) {
  if (sala.status !== 'jogando' || sala.jogadores[sala.turnoIndex].id !== jogador.id) return;
  if (sala.comprasAcumuladas > 0) {
    efetuarCompra(sala, jogador);
  } else {
    if (!sala.comprouNestaRodada) efetuarCompra(sala, jogador);
    efetuarPassagem(sala, jogador);
  }
  io.to(sala.id).emit('erro', `O tempo de ${jogador.nome} esgotou-se!`);
}

function agendarTurnoSeguranca(sala) {
  if (sala.status !== 'jogando') return;
  const jogadorAtual = sala.jogadores[sala.turnoIndex];
  if (!jogadorAtual) return;

  sala.turnoTimer = setTimeout(() => {
    estourarTempo(sala, jogadorAtual);
  }, 25000); 
}

function agendarTurnoBot(sala) {
  if (sala.status !== 'jogando') return;
  const jogadorAtual = sala.jogadores[sala.turnoIndex];
  if (!jogadorAtual || !jogadorAtual.isBot) return;
  
  const tempoPensamento = Math.floor(Math.random() * 1500) + 1000;
  sala.botTimer = setTimeout(() => executarTurnoBot(sala, jogadorAtual), tempoPensamento);
}

function executarTurnoBot(sala, bot) {
  if (sala.status !== 'jogando' || sala.jogadores[sala.turnoIndex].id !== bot.id) return;

  const cartaMesa = sala.mesa[sala.mesa.length - 1];
  let cartasValidas = [];

  const isMesaEscolherNumero = cartaMesa.originalValor === 'escolher_numero';

  if (sala.comprasAcumuladas > 0) {
    cartasValidas = bot.mao.filter(c => {
      const combina = c.cor === 'preto' || c.cor === cartaMesa.cor || c.valor === cartaMesa.valor;
      return (c.valor === '+2' || c.valor === '+3' || c.valor === '+4' || c.valor === '+6') && combina;
    });
  } else {
    cartasValidas = bot.mao.filter(c => {
      const isEfeito = ['bloqueio', 'inverter', '+2', '+3', '+4', '+6', 'espiar', 'igualar', 'reinicio', 'escolher_numero', 'coringa'].includes(c.originalValor);
      const combinaNormal = c.cor === 'preto' || c.cor === cartaMesa.cor || c.valor === cartaMesa.valor;
      return combinaNormal || (isMesaEscolherNumero && isEfeito);
    });
  }

  if (cartasValidas.length > 0) {
    cartasValidas.sort((a, b) => (a.cor === 'preto' ? 1 : -1));
    const escolhida = cartasValidas[0];
    
    let combo = [escolhida];
    if (escolhida.cor !== 'preto' && !['+2', '+3'].includes(escolhida.valor)) {
      const iguais = bot.mao.filter(c => c.valor === escolhida.valor && c.id !== escolhida.id && c.cor !== 'preto');
      combo = [escolhida, ...iguais];
    }

    let novaCor = null;
    let alvoTroca = null;
    let alvoOpcao = null;
    let alvoNumero = null;

    if (escolhida.cor === 'preto' && escolhida.valor !== 'escolher_numero') {
      const contagem = { 'vermelho': 0, 'azul': 0, 'verde': 0, 'amarelo': 0 };
      bot.mao.forEach(c => { if(contagem[c.cor] !== undefined) contagem[c.cor]++ });
      novaCor = Object.keys(contagem).reduce((a, b) => contagem[a] > contagem[b] ? a : b);
    }

    if (escolhida.valor === '0' || escolhida.valor === 'espiar') {
      let oponentes = sala.jogadores.filter(j => j.id !== bot.id);
      if(oponentes.length > 0) {
        oponentes.sort((a, b) => a.mao.length - b.mao.length);
        alvoTroca = oponentes[0].id;
      }
    }

    if (escolhida.valor === 'igualar') {
      alvoOpcao = bot.mao.length > 4 ? 'menor' : 'maior';
    }

    if (escolhida.valor === 'escolher_numero') {
      alvoNumero = Math.floor(Math.random() * 10).toString();
    }

    if (bot.mao.length - combo.length === 1) {
      bot.disseUno = true;
      io.to(sala.id).emit('erro', `${bot.nome} GRITOU KAOS!`);
    }

    efetuarJogada(sala, bot, combo, novaCor, alvoTroca, alvoOpcao, alvoNumero);
  } else {
    if (sala.comprouNestaRodada) {
      efetuarPassagem(sala, bot);
    } else {
      efetuarCompra(sala, bot);
    }
  }
}

function efetuarJogada(sala, jogador, cartas, novaCor, alvoTroca, alvoOpcao, alvoNumero) {
  if (!sala || sala.status !== 'jogando' || !jogador || sala.jogadores[sala.turnoIndex].id !== jogador.id) return;
  if (sala.eventoBateMesa && sala.eventoBateMesa.ativo) return io.to(jogador.id).emit('erro', 'Aguarde o fim do evento do 9!');
  if (!cartas || cartas.length === 0) return;

  const cartaMesa = sala.mesa[sala.mesa.length - 1];
  const primeiraCarta = cartas[0];
  const isPrimeiraCoringa = primeiraCarta.cor === 'preto';
  
  const isEfeito = ['bloqueio', 'inverter', '+2', '+3', '+4', '+6', 'espiar', 'igualar', 'reinicio', 'escolher_numero', 'coringa'].includes(primeiraCarta.originalValor);
  const anulaEscolherNumero = cartaMesa.originalValor === 'escolher_numero' && isEfeito;

  const combinaComMesa = isPrimeiraCoringa || primeiraCarta.cor === cartaMesa.cor || primeiraCarta.valor === cartaMesa.valor || anulaEscolherNumero;

  if (!combinaComMesa) return io.to(jogador.id).emit('erro', 'A primeira carta não combina com a mesa!');
  if (sala.comprasAcumuladas > 0 && !['+2', '+3', '+4', '+6'].includes(primeiraCarta.valor)) {
    return io.to(jogador.id).emit('erro', `Jogue uma carta de compra (+2/+3/+4/+6) ou compre ${sala.comprasAcumuladas} cartas.`);
  }
  if (!validarSequencia(cartas)) return io.to(jogador.id).emit('erro', 'Sequência inválida!');

  cartas.forEach(cartaJogada => {
    const index = jogador.mao.findIndex(c => c.id === cartaJogada.id);
    if (index !== -1) jogador.mao.splice(index, 1);
    sala.mesa.push(cartaJogada);
  });

  if (jogador.mao.length === 0) {
    sala.status = 'finalizado';
    jogador.vitorias = (jogador.vitorias || 0) + 1; 
    if(sala.botTimer) clearTimeout(sala.botTimer);
    if(sala.turnoTimer) clearTimeout(sala.turnoTimer);
    io.to(sala.id).emit('atualizar_jogadores', obterInfoJogadores(sala)); 
    return io.to(sala.id).emit('fim_de_jogo', jogador.nome);
  }

  const ultimaCartaJogada = sala.mesa[sala.mesa.length - 1];
  
  if (ultimaCartaJogada.valor === 'escolher_numero' && alvoNumero) {
    ultimaCartaJogada.valor = alvoNumero;
  } else if (ultimaCartaJogada.cor === 'preto' && novaCor) {
    ultimaCartaJogada.cor = novaCor;
  }

  let pulos = 1;
  if (cartas[0].originalValor === 'inverter') {
    if (cartas.length % 2 !== 0) sala.sentido *= -1;
  } else if (cartas[0].originalValor === 'bloqueio') {
    pulos = cartas.length + 1; 
  }

  const temEspiar = cartas.some(c => c.originalValor === 'espiar');
  if (temEspiar && alvoTroca) {
    const alvo = sala.jogadores.find(j => j.id === alvoTroca);
    if (alvo) {
      io.to(jogador.id).emit('mao_espiao', { nome: alvo.nome, cartas: alvo.mao });
      io.to(alvo.id).emit('erro', `${jogador.nome} bisbilhotou as suas cartas!`);
    }
  }

  const temIgualar = cartas.some(c => c.originalValor === 'igualar');
  if (temIgualar && alvoOpcao) {
    if (alvoOpcao === 'menor') {
      const menor = Math.min(...sala.jogadores.map(j => j.mao.length));
      sala.jogadores.forEach(j => {
        while(j.mao.length > menor) j.mao.pop();
      });
      io.to(sala.id).emit('erro', `Igualdade feita pela MENOR mão (${menor} cartas)!`);
    } else {
      const maior = Math.max(...sala.jogadores.map(j => j.mao.length));
      sala.jogadores.forEach(j => {
        garantirBaralho(sala, maior - j.mao.length);
        while(j.mao.length < maior) j.mao.push(sala.baralho.pop());
      });
      io.to(sala.id).emit('erro', `Igualdade feita pela MAIOR mão (${maior} cartas)!`);
    }
  }

  const temReinicio = cartas.some(c => c.originalValor === 'reinicio');
  if (temReinicio) {
    sala.jogadores.forEach(j => {
      garantirBaralho(sala, 7);
      j.mao = sala.baralho.splice(0, 7);
      j.disseUno = false;
    });
    io.to(sala.id).emit('erro', `JOGO REINICIADO! Todos receberam 7 novas cartas!`);
  }

  // EVENTOS 0 E 9 AGR CHECAM O VALOR ORIGINAL (IGNORA O "ESCOLHER_NUMERO")
  const temZero = cartas.some(c => c.originalValor === '0');
  if (temZero && alvoTroca) {
    if (alvoTroca === 'ninguem') {
      io.to(sala.id).emit('erro', `O jogador ${jogador.nome} manteve as cartas.`);
    } else if (alvoTroca === 'todos') {
      const maosAntigas = sala.jogadores.map(j => [...j.mao]);
      sala.jogadores.forEach((j, i) => {
        const idx = ((i - sala.sentido) % sala.jogadores.length + sala.jogadores.length) % sala.jogadores.length;
        j.mao = maosAntigas[idx];
      });
      io.to(sala.id).emit('erro', `Aviso: O jogador ${jogador.nome} rodou todas as mãos!`);
    } else {
      const jogadorAlvo = sala.jogadores.find(j => j.id === alvoTroca);
      if (jogadorAlvo) {
        const maoTemp = [...jogador.mao];
        jogador.mao = [...jogadorAlvo.mao];
        jogadorAlvo.mao = maoTemp;
        io.to(sala.id).emit('erro', `Aviso: ${jogador.nome} trocou as cartas com ${jogadorAlvo.nome}!`);
      }
    }
  }

  if (cartas[0].originalValor === '+2') sala.comprasAcumuladas += (2 * cartas.length);
  else if (cartas[0].originalValor === '+3') sala.comprasAcumuladas += (3 * cartas.length);
  else if (cartas[0].originalValor === '+4') sala.comprasAcumuladas += (4 * cartas.length);
  else if (cartas[0].originalValor === '+6') sala.comprasAcumuladas += (6 * cartas.length);

  const qtdNoves = cartas.filter(c => c.originalValor === '9').length; 
  if (qtdNoves > 0) {
    sala.eventoBateMesa = { ativo: true, jogadoresQueBateram: [], punicao: qtdNoves };
    io.to(sala.id).emit('iniciar_evento_nove');
    
    sala.jogadores.forEach(j => {
      if (j.isBot) {
        const reflexoBot = Math.floor(Math.random() * 2500) + 1500;
        setTimeout(() => efetuarBaterMesa(sala, j), reflexoBot);
      }
    });
  }

  sala.turnoIndex = ((sala.turnoIndex + (pulos * sala.sentido)) % sala.jogadores.length + sala.jogadores.length) % sala.jogadores.length;
  sala.comprouNestaRodada = false;

  emitirAtualizacao(sala, true);
}

function efetuarCompra(sala, jogador) {
  if (!sala || sala.status !== 'jogando' || !jogador || sala.jogadores[sala.turnoIndex].id !== jogador.id || sala.comprouNestaRodada) return;
  if (sala.eventoBateMesa && sala.eventoBateMesa.ativo) return;
  
  const qtdParaComprar = sala.comprasAcumuladas > 0 ? sala.comprasAcumuladas : 1;
  garantirBaralho(sala, qtdParaComprar);

  for (let i = 0; i < qtdParaComprar; i++) {
    if (sala.baralho.length > 0) jogador.mao.push(sala.baralho.pop());
  }
  jogador.disseUno = false;

  if (sala.comprasAcumuladas > 0) {
    sala.comprasAcumuladas = 0;
    sala.turnoIndex = ((sala.turnoIndex + sala.sentido) % sala.jogadores.length + sala.jogadores.length) % sala.jogadores.length;
    emitirAtualizacao(sala, true); 
  } else {
    sala.comprouNestaRodada = true;
    emitirAtualizacao(sala, false); 
  }
}

function efetuarPassagem(sala, jogador) {
  if (!sala || sala.status !== 'jogando' || !jogador || sala.jogadores[sala.turnoIndex].id !== jogador.id || !sala.comprouNestaRodada) return;
  if (sala.eventoBateMesa && sala.eventoBateMesa.ativo) return;

  sala.turnoIndex = ((sala.turnoIndex + sala.sentido) % sala.jogadores.length + sala.jogadores.length) % sala.jogadores.length;
  sala.comprouNestaRodada = false;
  emitirAtualizacao(sala, true); 
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
      emitirAtualizacao(sala, true); 
    }
  }
}

function efetuarKaos(sala, denunciante) {
  if (!sala || sala.status !== 'jogando' || !denunciante) return;
  let denunciouAlguem = false;
  let nomesInfratores = [];
  
  sala.jogadores.forEach(j => {
    if (j.mao.length === 1 && !j.disseUno && j.id !== denunciante.id) {
      garantirBaralho(sala, 1);
      if (sala.baralho.length > 0) j.mao.push(sala.baralho.pop());
      denunciouAlguem = true;
      nomesInfratores.push(j.nome);
    }
  });

  if (denunciouAlguem) {
    io.to(sala.id).emit('erro', `Aviso: ${nomesInfratores.join(', ')} esqueceu de gritar KAOS e comprou 1 carta!`);
    emitirAtualizacao(sala, false); 
    return; 
  }

  // CORREÇÃO: Permite salvar a si mesmo A QUALQUER MOMENTO se tiver <= 2 cartas[cite: 17]
  if (denunciante.mao.length <= 2) {
    denunciante.disseUno = true;
    io.to(sala.id).emit('erro', `${denunciante.nome} GRITOU KAOS!`);
  } else {
    io.to(denunciante.id).emit('erro', `Ninguém para denunciar!`);
  }
}

io.on('connection', (socket) => {
  console.log(`Um jogador conectou-se! ID: ${socket.id}`);

  const removerJogador = (socketId) => {
    for (const codigoSala in salas) {
      const sala = salas[codigoSala];
      const index = sala.jogadores.findIndex(j => j.id === socketId);
      
      if (index !== -1) {
        const nomeRemovido = sala.jogadores[index].nome;
        sala.jogadores.splice(index, 1);
        
        if (sala.jogadores.length === 0 || sala.jogadores.every(j => j.isBot)) {
          if (sala.botTimer) clearTimeout(sala.botTimer);
          if (sala.turnoTimer) clearTimeout(sala.turnoTimer);
          delete salas[codigoSala]; 
        } else {
          if (sala.status === 'jogando') {
            io.to(codigoSala).emit('erro', `Aviso: ${nomeRemovido} saiu da partida!`);
            if (index < sala.turnoIndex) sala.turnoIndex -= 1; 
            else if (index === sala.turnoIndex && sala.sentido === -1) sala.turnoIndex -= 1;
            
            if (sala.turnoIndex >= sala.jogadores.length || sala.turnoIndex < 0) sala.turnoIndex = 0;
            emitirAtualizacao(sala, false);
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
    salas[codigoSala] = { id: codigoSala, status: 'esperando', jogadores: [{ id: socket.id, nome: nomeJogador, avatar, isBot: false, vitorias: 0 }] };
    socket.join(codigoSala);
    socket.emit('sala_criada', codigoSala);
  });

  socket.on('entrar_sala', ({ codigoSala, nomeJogador, avatar }) => {
    const sala = salas[codigoSala];
    if (sala) {
      if (sala.status === 'jogando' || sala.status === 'sorteando') return socket.emit('erro', 'A partida já começou!');
      if (sala.jogadores.length >= 6) return socket.emit('erro', 'A sala está cheia.');
      
      sala.jogadores.push({ id: socket.id, nome: nomeJogador, avatar, isBot: false, vitorias: 0 });
      socket.join(codigoSala);
      io.to(codigoSala).emit('atualizar_jogadores', obterInfoJogadores(sala));
      socket.emit('entrou_na_sala', codigoSala);
    } else {
      socket.emit('erro', 'Código da sala não encontrado!');
    }
  });

  socket.on('iniciar_partida', (codigoSala) => {
    const sala = salas[codigoSala];
    if (sala && sala.jogadores[0].id === socket.id && sala.status !== 'sorteando' && sala.status !== 'jogando') {
      
      if (sala.jogadores.length === 1) {
        const nomesBots = [
          { nome: '[BOT] ASA', avatar: 'asa' }, { nome: '[BOT] BOTAS', avatar: 'botas' }, { nome: '[BOT] CAIM', avatar: 'caim' }
        ];
        nomesBots.forEach((b, i) => {
          sala.jogadores.push({
            id: `bot_${Date.now()}_${i}`, nome: b.nome, avatar: b.avatar, isBot: true, mao: [], disseUno: false, vitorias: 0
          });
        });
        io.to(codigoSala).emit('atualizar_jogadores', obterInfoJogadores(sala));
      }

      sala.status = 'sorteando';
      const sorteadoIndex = Math.floor(Math.random() * sala.jogadores.length);
      sala.turnoIndex = sorteadoIndex; 
      
      io.to(codigoSala).emit('sorteando_primeiro_jogador', sala.jogadores[sorteadoIndex].id);

      setTimeout(() => {
        if (!salas[codigoSala]) return;
        
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
              infoJogadores: obterInfoJogadores(sala),
              resetarTempo: true
            });
          }
        });
        agendarTurnoBot(sala);
        agendarTurnoSeguranca(sala);
      }, 3500); 
    }
  });

  socket.on('jogar_cartas', (dados) => {
    const sala = salas[dados.codigoSala];
    const jogador = sala?.jogadores.find(j => j.id === socket.id);
    efetuarJogada(sala, jogador, dados.cartas, dados.novaCor, dados.alvoTroca, dados.alvoOpcao, dados.alvoNumero);
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

  socket.on('enviar_emote', ({ codigoSala, emote }) => {
    io.to(codigoSala).emit('emote_recebido', { id: socket.id, emote });
  });

  socket.on('sair_sala', (codigoSala) => {
    socket.leave(codigoSala);
    removerJogador(socket.id);
  });

  socket.on('disconnect', () => {
    console.log(`Jogador desconectado: ${socket.id}`);
    removerJogador(socket.id);
  });
});

const porta = process.env.PORT || 3001;
server.listen(porta, () => {
  console.log(`Servidor a correr na porta ${porta}!`);
});