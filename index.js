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

function criarBaralho(regras = 'kaos') {
  const cores = ['vermelho', 'azul', 'verde', 'amarelo'];
  const valoresNormaisBase = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'bloqueio', 'inverter', '+2'];
  const valoresNormais = (regras === 'casual' || regras === 'boss' || regras === 'kaos_aleatorio') ? valoresNormaisBase : [...valoresNormaisBase, '+3'];
  
  let baralho = [];

  cores.forEach(cor => {
    valoresNormais.forEach(valor => {
      baralho.push({ id: Math.random().toString(36).substring(2, 10), cor, valor, originalCor: cor, originalValor: valor });
      if (valor !== '0') baralho.push({ id: Math.random().toString(36).substring(2, 10), cor, valor, originalCor: cor, originalValor: valor });
      if (['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(valor)) baralho.push({ id: Math.random().toString(36).substring(2, 10), cor, valor, originalCor: cor, originalValor: valor });
    });
  });

  for (let i = 0; i < 4; i++) {
    baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: 'coringa', originalCor: 'preto', originalValor: 'coringa' });
    baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: '+4', originalCor: 'preto', originalValor: '+4' });
    if (regras !== 'casual' && regras !== 'boss' && regras !== 'kaos_aleatorio') baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: 'espiar', originalCor: 'preto', originalValor: 'espiar' });
  }
  
  if (regras !== 'casual' && regras !== 'boss' && regras !== 'kaos_aleatorio') {
    for (let i = 0; i < 2; i++) {
      baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: '+6', originalCor: 'preto', originalValor: '+6' });
      baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: 'igualar', originalCor: 'preto', originalValor: 'igualar' });
      baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: 'reinicio', originalCor: 'preto', originalValor: 'reinicio' });
      baralho.push({ id: Math.random().toString(36).substring(2, 10), cor: 'preto', valor: 'escolher_numero', originalCor: 'preto', originalValor: 'escolher_numero' });
    }
  }

  for (let i = baralho.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [baralho[i], baralho[j]] = [baralho[j], baralho[i]];
  }
  return baralho;
}

function garantirBaralho(sala, qtdNecessaria) {
  if (sala.baralho.length < qtdNecessaria && sala.mesa.length > 1) {
    const topo = sala.mesa.pop(); 
    let cartasParaEmbaralhar = [...sala.mesa]; 
    for (let i = cartasParaEmbaralhar.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cartasParaEmbaralhar[i], cartasParaEmbaralhar[j]] = [cartasParaEmbaralhar[j], cartasParaEmbaralhar[i]];
    }
    cartasParaEmbaralhar = cartasParaEmbaralhar.map(c => ({ ...c, cor: c.originalCor, valor: c.originalValor }));
    sala.baralho = cartasParaEmbaralhar.concat(sala.baralho);
    sala.mesa = [topo];
    io.to(sala.id).emit('erro', 'Aviso: O monte acabou! As cartas da mesa foram reembaralhadas.');
  }
}

function validarSequencia(cartas) {
  if (cartas.length === 1) return true;
  if (cartas.every(c => c.valor === cartas[0].valor)) return true;
  if (cartas.every(c => !isNaN(c.valor) && c.cor === cartas[0].cor)) {
    const crescente = cartas.every((c, i) => i === 0 ? true : parseInt(c.valor) === parseInt(cartas[i - 1].valor) + 1);
    const decrescente = cartas.every((c, i) => i === 0 ? true : parseInt(c.valor) === parseInt(cartas[i - 1].valor) - 1);
    return crescente || decrescente;
  }
  return false;
}

const salas = {};

const obterInfoJogadores = (sala) => sala.jogadores.map(j => ({
  id: j.id, nome: j.nome, avatar: j.avatar, qtdCartas: j.mao ? j.mao.length : 0, 
  vitorias: j.vitorias || 0, offline: j.offline || false, corEquipe: j.corEquipe || null, isBoss: j.isBoss || false
}));

function emitirAtualizacao(sala, resetarTempo = true) {
  sala.jogadores.forEach(jogador => {
    if (!jogador.offline && !jogador.isBot) {
      io.to(jogador.id).emit('estado_atualizado', {
        minhaMao: jogador.mao, cartaMesa: sala.mesa[sala.mesa.length - 1], 
        turnoAtual: sala.jogadores[sala.turnoIndex].id, sentido: sala.sentido, 
        comprouNestaRodada: sala.comprouNestaRodada, comprasAcumuladas: sala.comprasAcumuladas,
        infoJogadores: obterInfoJogadores(sala), resetarTempo: resetarTempo, jogadaBossAtiva: sala.jogadaBossAtiva || 1
      });
    }
  });

  const humanoVulneravel = sala.jogadores.find(j => j.mao.length === 1 && !j.disseUno && !j.isBot);
  const algumBot = sala.jogadores.find(j => j.isBot);
  if (humanoVulneravel && algumBot) {
    setTimeout(() => {
      if (salas[sala.id] && salas[sala.id].status === 'jogando') {
        const alvo = salas[sala.id].jogadores.find(j => j.id === humanoVulneravel.id);
        if (alvo && alvo.mao.length === 1 && !alvo.disseUno) efetuarKaos(salas[sala.id], algumBot); 
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

// ==========================================
// FUNÇÕES DO KAOS ALEATÓRIO (EVENTOS GLOBAIS)
// ==========================================

function agendarEventoAleatorio(sala) {
  if (sala.status !== 'jogando' || sala.regras !== 'kaos_aleatorio') return;
  if (sala.eventoAleatorioTimer) clearTimeout(sala.eventoAleatorioTimer);
  
  sala.eventoAleatorioTimer = setTimeout(() => dispararEventoAleatorio(sala), 90000); // A cada 90 segundos
}

function dispararEventoAleatorio(sala) {
  if (sala.status !== 'jogando') return;
  
  // Pausa o jogo
  if (sala.turnoTimer) clearTimeout(sala.turnoTimer);
  if (sala.botTimer) clearTimeout(sala.botTimer);

  const eventos = [
    { id: 'inverter', titulo: "🔄 SENTIDO INVERTIDO!", descricao: "A ordem de jogo foi revertida repentinamente." },
    { id: 'passar_mao', titulo: "👐 RODA A RODA!", descricao: "Todos passam a sua mão para o jogador ao lado." },
    { id: 'comprar_4', titulo: "🃏 CHUVA DE CARTAS!", descricao: "O céu escureceu e todos compram 4 cartas!" },
    { id: 'igualar', titulo: "⚖️ EQUILÍBRIO!", descricao: "As mãos de todos os jogadores serão igualadas!" },
    { id: 'espiar', titulo: "👀 OLHOS BEM ABERTOS!", descricao: "Vais poder espiar as cartas do próximo jogador!" },
    { id: 'presente', titulo: "🎁 PRESENTE SURPRESA!", descricao: "Todos recebem uma carta extra de compra!" }
  ];

  const evento = eventos[Math.floor(Math.random() * eventos.length)];
  io.to(sala.id).emit('evento_aleatorio_iniciado', evento);

  // Executa após os 5s de exibição do modal
  setTimeout(() => {
    if (!salas[sala.id]) return;
    executarEventoAleatorio(sala, evento.id);
    io.to(sala.id).emit('evento_aleatorio_concluido');
    
    if (sala.status === 'jogando') {
      emitirAtualizacao(sala, true);
      agendarEventoAleatorio(sala); // Reagenda para daqui a 90 segundos
    }
  }, 5000);
}

function executarEventoAleatorio(sala, eventoId) {
  if (eventoId === 'inverter') {
    sala.sentido *= -1;
  } else if (eventoId === 'passar_mao') {
    const maosAntigas = sala.jogadores.map(j => [...j.mao]);
    sala.jogadores.forEach((j, i) => j.mao = maosAntigas[((i - sala.sentido) % sala.jogadores.length + sala.jogadores.length) % sala.jogadores.length]);
  } else if (eventoId === 'comprar_4') {
    sala.jogadores.forEach(j => {
      garantirBaralho(sala, 4);
      for (let i = 0; i < 4; i++) { if (sala.baralho.length > 0) j.mao.push(sala.baralho.pop()); }
    });
  } else if (eventoId === 'igualar') {
    const opcao = Math.random() > 0.5 ? 'maior' : 'menor';
    if (opcao === 'menor') {
      const menor = Math.min(...sala.jogadores.map(j => j.mao.length));
      let removidas = [];
      sala.jogadores.forEach(j => { while(j.mao.length > menor) removidas.push(j.mao.pop()); });
      removidas.forEach(c => { c.cor = c.originalCor; c.valor = c.originalValor; });
      sala.baralho = removidas.concat(sala.baralho);
    } else {
      const maior = Math.max(...sala.jogadores.map(j => j.mao.length));
      sala.jogadores.forEach(j => { garantirBaralho(sala, maior - j.mao.length); while(j.mao.length < maior && sala.baralho.length > 0) j.mao.push(sala.baralho.pop()); });
    }
  } else if (eventoId === 'espiar') {
    sala.jogadores.forEach((j, i) => {
      if (!j.isBot && !j.offline) {
        const proximoIndex = ((i + sala.sentido) % sala.jogadores.length + sala.jogadores.length) % sala.jogadores.length;
        const proximo = sala.jogadores[proximoIndex];
        io.to(j.id).emit('olhar_cartas_lado', { nome: proximo.nome, cartas: proximo.mao });
      }
    });
  } else if (eventoId === 'presente') {
    // BARALHO DE EMERGÊNCIA (Não retira da pilha principal para não quebrar a lógica)
    sala.jogadores.forEach(j => {
      const tipo = Math.random() < 0.2 ? '+4' : '+2'; // 20% de vir um +4, 80% de um +2
      const cor = tipo === '+4' ? 'preto' : ['vermelho', 'azul', 'verde', 'amarelo'][Math.floor(Math.random() * 4)];
      const cartaEmergencia = { 
        id: `emg_${Math.random().toString(36).substring(2, 10)}`, 
        cor: cor, valor: tipo, originalCor: cor, originalValor: tipo 
      };
      j.mao.push(cartaEmergencia);
    });
  }
}

// ==========================================

function avancarTurno(sala, pulosExtras = 0) {
  const jogadorAtual = sala.jogadores[sala.turnoIndex];
  let pulosTotal = 1 + pulosExtras + (sala.pulosAcumulados || 0);

  if (sala.regras === 'boss' && jogadorAtual.isBoss) {
    if (sala.jogadaBossAtiva === 1) {
      sala.jogadaBossAtiva = 2;
      sala.pulosAcumulados = (sala.pulosAcumulados || 0) + pulosExtras; 
      sala.comprouNestaRodada = false; 
      emitirAtualizacao(sala, true);
      return; 
    } else {
      sala.jogadaBossAtiva = 1;
      sala.pulosAcumulados = 0;
    }
  } else {
    sala.pulosAcumulados = 0;
  }

  sala.turnoIndex = ((sala.turnoIndex + (pulosTotal * sala.sentido)) % sala.jogadores.length + sala.jogadores.length) % sala.jogadores.length;
  sala.comprouNestaRodada = false;
  
  if (sala.regras === 'boss' && sala.jogadores[sala.turnoIndex].isBoss) sala.jogadaBossAtiva = 1;
  
  emitirAtualizacao(sala, true);
}

function estourarTempo(sala, jogador) {
  if (sala.status !== 'jogando' || sala.jogadores[sala.turnoIndex].id !== jogador.id) return;
  if (sala.comprasAcumuladas > 0) efetuarCompra(sala, jogador);
  else { if (!sala.comprouNestaRodada) efetuarCompra(sala, jogador); efetuarPassagem(sala, jogador); }
  io.to(sala.id).emit('erro', `O tempo de ${jogador.nome} esgotou-se!`);
}

function agendarTurnoSeguranca(sala) {
  if (sala.status !== 'jogando') return;
  const jogadorAtual = sala.jogadores[sala.turnoIndex];
  if (!jogadorAtual) return;
  sala.turnoTimer = setTimeout(() => estourarTempo(sala, jogadorAtual), 25000); 
}

function agendarTurnoBot(sala) {
  if (sala.status !== 'jogando') return;
  const jogadorAtual = sala.jogadores[sala.turnoIndex];
  if (!jogadorAtual || (!jogadorAtual.isBot && !jogadorAtual.offline)) return;
  const tempoPensamento = Math.floor(Math.random() * 1500) + 1000;
  sala.botTimer = setTimeout(() => executarTurnoBot(sala, jogadorAtual), tempoPensamento);
}

function executarTurnoBot(sala, bot) {
  if (sala.status !== 'jogando' || sala.jogadores[sala.turnoIndex].id !== bot.id) return;
  const cartaMesa = sala.mesa[sala.mesa.length - 1];
  let cartasValidas = [];
  const isMesaEscolherNumero = cartaMesa.originalValor === 'escolher_numero';

  if (sala.comprasAcumuladas > 0) {
    cartasValidas = bot.mao.filter(c => (c.valor === '+2' || c.valor === '+3' || c.valor === '+4' || c.valor === '+6') && (c.cor === 'preto' || c.cor === cartaMesa.cor || c.valor === cartaMesa.valor));
  } else {
    cartasValidas = bot.mao.filter(c => {
      const isEfeito = ['bloqueio', 'inverter', '+2', '+3', '+4', '+6', 'espiar', 'igualar', 'reinicio', 'escolher_numero', 'coringa'].includes(c.originalValor);
      return (c.cor === 'preto' || c.cor === cartaMesa.cor || c.valor === cartaMesa.valor) || (isMesaEscolherNumero && isEfeito);
    });
  }

  if (cartasValidas.length > 0) {
    cartasValidas.sort((a, b) => (a.cor === 'preto' ? 1 : -1));
    const escolhida = cartasValidas[0];
    let combo = [escolhida];
    if (escolhida.cor !== 'preto' && !['+2', '+3'].includes(escolhida.valor)) combo = [escolhida, ...bot.mao.filter(c => c.valor === escolhida.valor && c.id !== escolhida.id && c.cor !== 'preto')];

    let novaCor = null, alvoTroca = null, alvoOpcao = null, alvoNumero = null;
    if (escolhida.cor === 'preto' && escolhida.valor !== 'escolher_numero') {
      const contagem = { 'vermelho': 0, 'azul': 0, 'verde': 0, 'amarelo': 0 };
      bot.mao.forEach(c => { if(contagem[c.cor] !== undefined) contagem[c.cor]++ });
      novaCor = Object.keys(contagem).reduce((a, b) => contagem[a] > contagem[b] ? a : b);
    }
    if (escolhida.valor === '0' || escolhida.valor === 'espiar') {
      let oponentes = sala.jogadores.filter(j => j.id !== bot.id).sort((a, b) => a.mao.length - b.mao.length);
      if(oponentes.length > 0) alvoTroca = oponentes[0].id; 
    }
    if (escolhida.valor === 'igualar') alvoOpcao = bot.mao.length > 4 ? 'menor' : 'maior';
    if (escolhida.valor === 'escolher_numero') alvoNumero = Math.floor(Math.random() * 10).toString();
    if (bot.mao.length - combo.length === 1) { bot.disseUno = true; io.to(sala.id).emit('erro', `${bot.nome} GRITOU KAOS!`); }
    efetuarJogada(sala, bot, combo, novaCor, alvoTroca, alvoOpcao, alvoNumero);
  } else {
    if (sala.comprouNestaRodada) efetuarPassagem(sala, bot);
    else efetuarCompra(sala, bot);
  }
}

function efetuarJogada(sala, jogador, cartas, novaCor, alvoTroca, alvoOpcao, alvoNumero) {
  if (!sala || sala.status !== 'jogando' || !jogador || sala.jogadores[sala.turnoIndex].id !== jogador.id) return;
  if (sala.eventoBateMesa && sala.eventoBateMesa.ativo) return io.to(jogador.id).emit('erro', 'Aguarde o fim do evento do 9!');
  if (!cartas || cartas.length === 0) return;

  const cartaMesa = sala.mesa[sala.mesa.length - 1];
  const primeiraCarta = cartas[0];
  const isEfeito = ['bloqueio', 'inverter', '+2', '+3', '+4', '+6', 'espiar', 'igualar', 'reinicio', 'escolher_numero', 'coringa'].includes(primeiraCarta.originalValor);
  
  if (!(primeiraCarta.cor === 'preto' || primeiraCarta.cor === cartaMesa.cor || primeiraCarta.valor === cartaMesa.valor || (cartaMesa.originalValor === 'escolher_numero' && isEfeito))) {
    return io.to(jogador.id).emit('erro', 'A primeira carta não combina com a mesa!');
  }
  if (sala.comprasAcumuladas > 0 && !['+2', '+3', '+4', '+6'].includes(primeiraCarta.valor)) return io.to(jogador.id).emit('erro', `Jogue uma carta de compra ou compre ${sala.comprasAcumuladas} cartas.`);
  if (!validarSequencia(cartas)) return io.to(jogador.id).emit('erro', 'Sequência inválida!');

  cartas.forEach(cartaJogada => {
    const index = jogador.mao.findIndex(c => c.id === cartaJogada.id);
    if (index !== -1) jogador.mao.splice(index, 1);
    sala.mesa.push(cartaJogada);
  });

  if (jogador.mao.length === 0) {
    sala.status = 'finalizado';
    if(sala.botTimer) clearTimeout(sala.botTimer);
    if(sala.turnoTimer) clearTimeout(sala.turnoTimer);
    if(sala.eventoAleatorioTimer) clearTimeout(sala.eventoAleatorioTimer);

    if (sala.regras === 'boss') {
      if (jogador.isBoss) {
        jogador.vitorias = (jogador.vitorias || 0) + 1;
        io.to(sala.id).emit('fim_de_jogo', `😈 O BOSS (${jogador.nome})`);
      } else {
        sala.jogadores.forEach(j => { if (!j.isBoss) j.vitorias = (j.vitorias || 0) + 1; });
        io.to(sala.id).emit('fim_de_jogo', `A ALIANÇA (Equipe de ${jogador.nome})`);
      }
    } else if (sala.formato === 'duplas') {
      const parceiro = sala.jogadores[(sala.jogadores.findIndex(j => j.id === jogador.id) + sala.jogadores.length / 2) % sala.jogadores.length];
      jogador.vitorias = (jogador.vitorias || 0) + 1;
      if (parceiro) parceiro.vitorias = (parceiro.vitorias || 0) + 1;
      io.to(sala.id).emit('fim_de_jogo', `${jogador.nome} & ${parceiro ? parceiro.nome : 'Parceiro'}`);
    } else {
      jogador.vitorias = (jogador.vitorias || 0) + 1; 
      io.to(sala.id).emit('fim_de_jogo', jogador.nome);
    }
    io.to(sala.id).emit('atualizar_jogadores', obterInfoJogadores(sala));
    return;
  }

  const ultima = sala.mesa[sala.mesa.length - 1];
  if (ultima.valor === 'escolher_numero' && alvoNumero) ultima.valor = alvoNumero;
  else if (ultima.cor === 'preto' && novaCor) ultima.cor = novaCor;

  let pulosExtras = 0;
  if (cartas[0].originalValor === 'inverter') { if (cartas.length % 2 !== 0) sala.sentido *= -1; } 
  else if (cartas[0].originalValor === 'bloqueio') { pulosExtras = cartas.length; }

  const temEspiar = cartas.some(c => c.originalValor === 'espiar');
  if (temEspiar && alvoTroca) io.to(alvoTroca).emit('erro', `${jogador.nome} bisbilhotou as suas cartas!`);

  const temIgualar = cartas.some(c => c.originalValor === 'igualar');
  if (temIgualar && alvoOpcao) {
    if (alvoOpcao === 'menor') {
      const menor = Math.min(...sala.jogadores.map(j => j.mao.length));
      let removidas = [];
      sala.jogadores.forEach(j => { while(j.mao.length > menor) removidas.push(j.mao.pop()); });
      removidas.forEach(c => { c.cor = c.originalCor; c.valor = c.originalValor; });
      sala.baralho = removidas.concat(sala.baralho);
      io.to(sala.id).emit('erro', `Igualdade feita pela MENOR mão (${menor} cartas)!`);
    } else {
      const maior = Math.max(...sala.jogadores.map(j => j.mao.length));
      sala.jogadores.forEach(j => { garantirBaralho(sala, maior - j.mao.length); while(j.mao.length < maior && sala.baralho.length > 0) j.mao.push(sala.baralho.pop()); });
      io.to(sala.id).emit('erro', `Igualdade feita pela MAIOR mão (${maior} cartas)!`);
    }
  }

  const temReinicio = cartas.some(c => c.originalValor === 'reinicio');
  if (temReinicio) {
    let recolhidas = [];
    sala.jogadores.forEach(j => { recolhidas = recolhidas.concat(j.mao); j.mao = []; });
    recolhidas.forEach(c => { c.cor = c.originalCor; c.valor = c.originalValor; });
    for (let i = recolhidas.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [recolhidas[i], recolhidas[k]] = [recolhidas[k], recolhidas[i]]; }
    sala.baralho = recolhidas.concat(sala.baralho);
    sala.jogadores.forEach(j => { garantirBaralho(sala, 7); j.mao = sala.baralho.splice(0, 7); j.disseUno = false; });
    io.to(sala.id).emit('erro', `JOGO REINICIADO! Todos receberam 7 novas cartas!`);
  }

  const temZero = cartas.some(c => c.originalValor === '0');
  if (temZero && sala.regras !== 'boss' && alvoTroca) {
    if (alvoTroca === 'ninguem') io.to(sala.id).emit('erro', `O jogador ${jogador.nome} manteve as cartas.`);
    else if (alvoTroca === 'todos') {
      const maosAntigas = sala.jogadores.map(j => [...j.mao]);
      sala.jogadores.forEach((j, i) => j.mao = maosAntigas[((i - sala.sentido) % sala.jogadores.length + sala.jogadores.length) % sala.jogadores.length]);
      io.to(sala.id).emit('erro', `Aviso: ${jogador.nome} rodou todas as mãos!`);
    } else {
      const jogadorAlvo = sala.jogadores.find(j => j.id === alvoTroca);
      if (jogadorAlvo) { const maoTemp = [...jogador.mao]; jogador.mao = [...jogadorAlvo.mao]; jogadorAlvo.mao = maoTemp; io.to(sala.id).emit('erro', `Aviso: ${jogador.nome} trocou as cartas com ${jogadorAlvo.nome}!`); }
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
    sala.jogadores.forEach(j => { if (j.isBot || j.offline) setTimeout(() => efetuarBaterMesa(sala, j), Math.floor(Math.random() * 2500) + 1500); });
  }

  avancarTurno(sala, pulosExtras);
}

function efetuarCompra(sala, jogador) {
  if (!sala || sala.status !== 'jogando' || !jogador || sala.jogadores[sala.turnoIndex].id !== jogador.id || sala.comprouNestaRodada) return;
  if (sala.eventoBateMesa && sala.eventoBateMesa.ativo) return;
  
  const qtdParaComprar = sala.comprasAcumuladas > 0 ? sala.comprasAcumuladas : 1;
  garantirBaralho(sala, qtdParaComprar);
  
  for (let i = 0; i < qtdParaComprar; i++) { if (sala.baralho.length > 0) jogador.mao.push(sala.baralho.pop()); }
  jogador.disseUno = false;
  
  if (sala.comprasAcumuladas > 0) { 
    sala.comprasAcumuladas = 0; 
    avancarTurno(sala, 0);
  } else { 
    sala.comprouNestaRodada = true; 
    emitirAtualizacao(sala, false); 
  }
}

function efetuarPassagem(sala, jogador) {
  if (!sala || sala.status !== 'jogando' || !jogador || sala.jogadores[sala.turnoIndex].id !== jogador.id || !sala.comprouNestaRodada) return;
  if (sala.eventoBateMesa && sala.eventoBateMesa.ativo) return;
  avancarTurno(sala, 0);
}

function efetuarBaterMesa(sala, jogador) {
  if (!sala || !sala.eventoBateMesa || !sala.eventoBateMesa.ativo) return;
  if (sala.eventoBateMesa.jogadoresQueBateram.includes(jogador.id)) return;
  
  sala.eventoBateMesa.jogadoresQueBateram.push(jogador.id);
  
  if (sala.eventoBateMesa.jogadoresQueBateram.length === sala.jogadores.length - 1) {
    const lerdinho = sala.jogadores.find(j => !sala.eventoBateMesa.jogadoresQueBateram.includes(j.id));
    if (lerdinho) {
      garantirBaralho(sala, sala.eventoBateMesa.punicao);
      for (let i = 0; i < sala.eventoBateMesa.punicao; i++) { if (sala.baralho.length > 0) lerdinho.mao.push(sala.baralho.pop()); }
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
      denunciouAlguem = true; nomesInfratores.push(j.nome);
    }
  });

  if (denunciouAlguem) {
    io.to(sala.id).emit('erro', `Aviso: ${nomesInfratores.join(', ')} esqueceu de gritar KAOS e comprou 1 carta!`);
    emitirAtualizacao(sala, false); 
  } else if (denunciante.mao.length === 1) {
    denunciante.disseUno = true;
    io.to(sala.id).emit('erro', `${denunciante.nome} GRITOU KAOS!`);
  } else if (denunciante.mao.length === 2 && sala.jogadores[sala.turnoIndex].id === denunciante.id) {
    denunciante.disseUno = true; io.to(sala.id).emit('erro', `${denunciante.nome} GRITOU KAOS!`);
  } else { 
    io.to(denunciante.id).emit('erro', `Ninguém para denunciar!`); 
  }
}

io.on('connection', (socket) => {
  const removerJogador = (socketId) => {
    for (const codigoSala in salas) {
      const sala = salas[codigoSala];
      const index = sala.jogadores.findIndex(j => j.id === socketId);
      if (index !== -1) {
        const jogador = sala.jogadores[index];
        if (sala.status === 'jogando' || sala.status === 'sorteando') {
          jogador.offline = true;
          io.to(codigoSala).emit('erro', `Aviso: ${jogador.nome} perdeu a conexão!`);
          io.to(codigoSala).emit('atualizar_jogadores', obterInfoJogadores(sala));
        } else { sala.jogadores.splice(index, 1); }
        if (!sala.jogadores.some(j => !j.isBot && !j.offline)) {
          if (sala.botTimer) clearTimeout(sala.botTimer);
          if (sala.turnoTimer) clearTimeout(sala.turnoTimer);
          if (sala.eventoAleatorioTimer) clearTimeout(sala.eventoAleatorioTimer); // Limpa o evento de Kaos Aleatório!
          delete salas[codigoSala]; 
        } else if (sala.status !== 'jogando' && sala.status !== 'sorteando') { io.to(codigoSala).emit('atualizar_jogadores', obterInfoJogadores(sala)); }
        break; 
      }
    }
  };

  socket.on('criar_sala', ({ nomeJogador, avatar }) => {
    const codigoSala = Math.floor(1000 + Math.random() * 9000).toString();
    salas[codigoSala] = { id: codigoSala, status: 'esperando', regras: 'kaos', formato: 'pvp', jogadores: [{ id: socket.id, nome: nomeJogador, avatar, isBot: false, vitorias: 0, offline: false, corEquipe: null, isBoss: false }] };
    socket.join(codigoSala); socket.emit('sala_criada', codigoSala);
  });

  socket.on('entrar_sala', ({ codigoSala, nomeJogador, avatar }) => {
    const sala = salas[codigoSala];
    if (sala) {
      const jogadorDesconectado = sala.jogadores.find(j => j.nome.toLowerCase().trim() === nomeJogador.toLowerCase().trim() && j.offline);
      if (jogadorDesconectado) {
        jogadorDesconectado.id = socket.id; jogadorDesconectado.offline = false; jogadorDesconectado.avatar = avatar;
        socket.join(codigoSala); socket.emit('entrou_na_sala', codigoSala);
        if (sala.status === 'jogando' || sala.status === 'sorteando') {
          socket.emit('partida_iniciada', { minhaMao: jogadorDesconectado.mao, cartaMesa: sala.mesa[sala.mesa.length - 1], turnoAtual: sala.jogadores[sala.turnoIndex].id, sentido: sala.sentido, comprouNestaRodada: sala.comprouNestaRodada, comprasAcumuladas: sala.comprasAcumuladas, infoJogadores: obterInfoJogadores(sala), resetarTempo: false, jogadaBossAtiva: sala.jogadaBossAtiva || 1 });
        }
        io.to(codigoSala).emit('atualizar_jogadores', obterInfoJogadores(sala));
        io.to(codigoSala).emit('erro', `${nomeJogador} reconectou-se à partida!`);
        return;
      }
      if (sala.status === 'jogando' || sala.status === 'sorteando') return socket.emit('erro', 'A partida já começou!');
      if (sala.jogadores.length >= 6) return socket.emit('erro', 'A sala está cheia.');
      sala.jogadores.push({ id: socket.id, nome: nomeJogador, avatar, isBot: false, vitorias: 0, offline: false, corEquipe: null, isBoss: false });
      socket.join(codigoSala); io.to(codigoSala).emit('atualizar_jogadores', obterInfoJogadores(sala)); socket.emit('entrou_na_sala', codigoSala);
    } else { socket.emit('erro', 'Código da sala não encontrado!'); }
  });

  socket.on('adicionar_bot', ({ codigoSala, nomeBot }) => {
    const sala = salas[codigoSala];
    if (sala && (sala.status === 'esperando' || sala.status === 'finalizado') && sala.jogadores.length < 6 && sala.jogadores[0].id === socket.id) {
      sala.jogadores.push({ id: `bot_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, nome: nomeBot, avatar: nomeBot.toLowerCase().replace(/[^a-z]/g, ''), isBot: true, mao: [], disseUno: false, vitorias: 0, offline: false, corEquipe: null, isBoss: false });
      io.to(codigoSala).emit('atualizar_jogadores', obterInfoJogadores(sala));
    }
  });

  socket.on('remover_jogador', ({ codigoSala, alvoId }) => {
    const sala = salas[codigoSala];
    if (sala && (sala.status === 'esperando' || sala.status === 'finalizado') && sala.jogadores[0].id === socket.id) {
      const index = sala.jogadores.findIndex(j => j.id === alvoId);
      if (index > 0) { const j = sala.jogadores[index]; sala.jogadores.splice(index, 1); io.to(codigoSala).emit('atualizar_jogadores', obterInfoJogadores(sala)); if (!j.isBot) io.to(alvoId).emit('voce_foi_removido'); }
    }
  });

  socket.on('reordenar_jogadores', ({ codigoSala, novaOrdem }) => {
    const sala = salas[codigoSala];
    if (sala && (sala.status === 'esperando' || sala.status === 'finalizado') && sala.jogadores[0].id === socket.id) {
      const novaLista = []; novaOrdem.forEach(id => { const jog = sala.jogadores.find(j => j.id === id); if (jog) novaLista.push(jog); });
      if (novaLista.length === sala.jogadores.length) { sala.jogadores = novaLista; io.to(codigoSala).emit('atualizar_jogadores', obterInfoJogadores(sala)); }
    }
  });

  socket.on('iniciar_partida', (dados) => {
    const sala = salas[dados.codigoSala];
    if (sala && sala.jogadores[0].id === socket.id && sala.status !== 'sorteando' && sala.status !== 'jogando') {
      sala.regras = dados.regras || 'kaos'; 
      sala.formato = sala.regras === 'boss' ? 'pvp' : (dados.formato || 'pvp');
      
      if (sala.jogadores.length === 1) {
        ['[BOT] ASA', '[BOT] BOTAS', '[BOT] CAIM'].forEach((nome, i) => { sala.jogadores.push({ id: `bot_${i}`, nome, avatar: nome.toLowerCase().replace(/[^a-z]/g, ''), isBot: true, mao: [], disseUno: false, vitorias: 0, offline: false, corEquipe: null, isBoss: false }); });
        io.to(dados.codigoSala).emit('atualizar_jogadores', obterInfoJogadores(sala));
      }

      if (sala.formato === 'duplas' && sala.regras !== 'boss') {
        sala.jogadores.forEach((j, index) => j.corEquipe = ['#ff4757', '#f1c40f', '#3498db'][index % Math.floor(sala.jogadores.length / 2)]);
      } else {
        sala.jogadores.forEach(j => j.corEquipe = null);
      }

      if (sala.regras === 'boss') {
        const sorteadoIndex = Math.floor(Math.random() * sala.jogadores.length);
        sala.jogadores.forEach((j, i) => j.isBoss = (i === sorteadoIndex));
        sala.jogadaBossAtiva = 1;
        sala.pulosAcumulados = 0;
        sala.turnoIndex = sorteadoIndex;
      } else {
        sala.turnoIndex = Math.floor(Math.random() * sala.jogadores.length); 
        sala.jogadores.forEach(j => j.isBoss = false);
      }

      sala.status = 'sorteando';
      io.to(dados.codigoSala).emit('sorteando_primeiro_jogador', sala.jogadores[sala.turnoIndex].id);

      setTimeout(() => {
        if (!salas[dados.codigoSala]) return;
        sala.status = 'jogando';
        sala.baralho = criarBaralho(sala.regras); 
        sala.mesa = [];

        sala.jogadores.forEach(jogador => { 
          const qtd = (sala.regras === 'boss' && jogador.isBoss) ? 20 : 7;
          garantirBaralho(sala, qtd);
          jogador.mao = sala.baralho.splice(0, qtd); 
          jogador.disseUno = false; 
        });
        
        const indexCartaValida = sala.baralho.findIndex(c => !isNaN(c.valor) && c.cor !== 'preto');
        let cartaTopo = sala.baralho.splice(indexCartaValida, 1)[0];
        sala.mesa.push(cartaTopo); sala.sentido = 1; sala.comprouNestaRodada = false; sala.comprasAcumuladas = 0;
        sala.eventoBateMesa = { ativo: false, jogadoresQueBateram: [], punicao: 0 };

        sala.jogadores.forEach(jogador => {
          if (!jogador.isBot && !jogador.offline) {
            io.to(jogador.id).emit('partida_iniciada', { minhaMao: jogador.mao, cartaMesa: cartaTopo, turnoAtual: sala.jogadores[sala.turnoIndex].id, sentido: sala.sentido, comprouNestaRodada: sala.comprouNestaRodada, comprasAcumuladas: sala.comprasAcumuladas, infoJogadores: obterInfoJogadores(sala), resetarTempo: true, jogadaBossAtiva: sala.jogadaBossAtiva || 1 });
          }
        });
        
        agendarTurnoBot(sala); 
        agendarTurnoSeguranca(sala);
        
        // Ativa o timer inicial se for o modo Kaos Aleatório!
        if (sala.regras === 'kaos_aleatorio') {
          agendarEventoAleatorio(sala);
        }
      }, 3500); 
    }
  });

  socket.on('espiar_cartas_alvo', ({ codigoSala, alvoId }) => { const sala = salas[codigoSala]; if (sala && sala.status === 'jogando') { const alvo = sala.jogadores.find(j => j.id === alvoId); if (alvo) socket.emit('mao_espiao_previa', { nome: alvo.nome, cartas: alvo.mao }); } });
  socket.on('jogar_cartas', (d) => { const s = salas[d.codigoSala]; efetuarJogada(s, s?.jogadores.find(j => j.id === socket.id), d.cartas, d.novaCor, d.alvoTroca, d.alvoOpcao, d.alvoNumero); });
  socket.on('apertar_uno', (c) => { const s = salas[c]; efetuarKaos(s, s?.jogadores.find(j => j.id === socket.id)); });
  socket.on('comprar_carta', (c) => { const s = salas[c]; efetuarCompra(s, s?.jogadores.find(j => j.id === socket.id)); });
  socket.on('passar_vez', (c) => { const s = salas[c]; efetuarPassagem(s, s?.jogadores.find(j => j.id === socket.id)); });
  socket.on('bater_mesa', (c) => { const s = salas[c]; const j = s?.jogadores.find(j => j.id === socket.id); if (j) efetuarBaterMesa(s, j); });
  socket.on('enviar_emote', ({ codigoSala, emote }) => { io.to(codigoSala).emit('emote_recebido', { id: socket.id, emote }); });
  socket.on('sair_sala', (c) => { socket.leave(c); removerJogador(socket.id); });
  socket.on('disconnect', () => { removerJogador(socket.id); });
});

const porta = process.env.PORT || 3001;
server.listen(porta, () => { console.log(`Servidor a correr na porta ${porta}!`); });