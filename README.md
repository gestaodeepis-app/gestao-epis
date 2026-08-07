# Gestão de EPIs v1.4.1

Principais mudanças:
- Menu lateral mais estreito e perfil do usuário no rodapé.
- Logo da empresa maior e com cantos arredondados.
- Dashboard corrigido para não gerar rolagem horizontal da página.
- EPI separado por usina, com estoque independente por unidade.
- Devolução com destino Reestoque ou Descarte.
- Remoção de movimentações, colaboradores, EPIs, usinas e usuários conforme permissões.
- Proprietário pode remover usuários; Administrador não pode remover usuários; Visualizador não remove nada.
- Nome do usuário editável na aba Usuários.
- Relatório geral com busca sugestiva de colaborador, usina automática e período.

## IMPORTANTE
Esta versão precisa das novas regras do arquivo `firestore.rules`. Publique-as no Firebase após atualizar o GitHub.

Usuários removidos pelo sistema perdem o documento de perfil e, portanto, o acesso ao app. O registro correspondente no Firebase Authentication permanece até ser removido manualmente no console do Firebase.

## v1.4.2
- Removido o fundo branco atrás do ícone do app na tela de login.
- Removidos pop-ups de sucesso que exigiam clicar em OK após salvar/adicionar.
- Menu lateral reduzido para 220 px e restaurado para verde #529468.
- Menu interno rolável e rodapé fixo para manter perfil e botão Sair visíveis.
- Registro de entrega/devolução agora permite digitar o nome do colaborador com sugestões.

## v1.4.3
- Histórico completo do colaborador acessível pelo nome ou botão Histórico.
- Card de assinaturas pendentes no Dashboard agora é clicável e abre as movimentações já filtradas.
- Alerta de assinaturas pendentes também é clicável.
- Modo mobile com menu lateral em gaveta, botão hambúrguer, overlay, modais adaptados e cards responsivos.

## v1.5
- Dashboard mais compacto com ícones, filtro por usina e ações rápidas.
- Menu refinado com badges de pendências e separação de Configurações.
- Colaboradores em cards modernos com ficha/histórico.
- EPIs em cards por usina com indicador visual de estoque.
- Campo Estoque mínimo por EPI, usado para alertas automáticos.
- Busca global por colaborador, EPI, C.A., usina e movimentação (Ctrl+K).
- Notificações toast sem exigir clique em OK.
- Barra inferior mobile: Início, Movimentações, EPIs e Mais.
- Layout responsivo refinado para celular.

## v1.5.1
- Correção de login causada por mistura de cache entre index.html antigo e app.js novo.
- Renderização compatível durante atualização do GitHub Pages.
- Cache-busting de app.js/styles.css e navegação network-first.

## v1.6
- Interface redesenhada, gráfico, Cards/Lista, fotos de usuários, edição de colaboradores/movimentações, remoção de auditoria pelo proprietário, login persistente e autocomplete de colaboradores.
- IMPORTANTE: publicar as novas regras do arquivo firestore.rules.

## v1.6.1
- Corrigido mecanismo de atualização/caches do GitHub Pages.
- index.html, app.js, styles.css e version.json usam estratégia network-first.
- Adicionado detector automático de nova versão.
- Quando houver versão nova, aparece o botão "Atualização disponível / Atualizar sistema".
- O botão limpa Service Workers e caches antigos e recarrega a versão atual.

## v1.6.2
- Auditoria com seleção múltipla, remover selecionados e remover tudo (somente Proprietário).
- Auditoria carregada somente quando a aba é aberta, reduzindo o tempo de entrada no sistema.
- Registro de auditoria passa a ser assíncrono e não bloqueia salvamentos.
- Cadastros simples atualizam a interface localmente sem recarregar todas as coleções do Firestore.
- Movimentações recarregam apenas EPIs e movimentações após alteração.
- Cards de colaboradores redesenhados com botões alinhados e visual mais profissional.

## v1.6.3
- Removidas as janelas nativas de confirmação (OK/Cancelar) das ações de remoção.
- Exclusões agora são executadas imediatamente e o resultado aparece por notificação discreta.
- Mantidas as validações de segurança e permissões por perfil.

## v1.7 — Interface & Gestão
- Barra superior corporativa com notificações, status Online/Offline e perfil.
- Central de notificações para estoque zerado, estoque mínimo e assinatura pendente.
- Dashboard executivo: estoque por usina, EPIs mais entregues e atenções do sistema.
- Presença/último acesso dos usuários.
- Configurações ampliadas com Sistema e Notificações.
- Regras atualizadas para lastSeenAt e lastSeenDevice.

## v1.8 — Produtividade
- Corrigida alteração do status de assinatura (bug de referência interna).
- Eliminadas janelas nativas de alerta/OK; erros agora usam notificações toast.
- Central de notificações com "Marcar como lida" e "Marcar todas como lidas".
- Ficha individual do colaborador ampliada com ações rápidas, QR Code e impressão profissional.
- QR do colaborador abre diretamente a ficha após o login.
- Impressão da ficha individual com histórico, dados funcionais e campos de assinatura.

## v1.9 — Inteligência de estoque
- Consumo médio mensal calculado pelas entregas dos últimos 90 dias.
- Autonomia estimada do estoque por EPI.
- Classificação de previsão: Normal, Atenção e Crítico.
- Dashboard com painel de previsão de reposição.
- Cards e lista de EPIs mostram consumo/mês e autonomia.
- Ficha do colaborador ganhou Baixar QR PNG em alta resolução.
- Adicionado Imprimir QR com etiqueta pronta para recorte e fixação na ficha física.
- Não exige alteração nas Rules do Firestore.

## v2.0 — Administração e Segurança
- Autocadastro na tela de login.
- Novo usuário nasce PENDENTE, sem função e sem usina.
- Aprovação exclusiva do Proprietário.
- Proprietário define Administrador, SSMA ou Visualizador e a usina.
- Tela de aguardando aprovação com verificação automática a cada 5 segundos.
- Confirmação visual quando o acesso for aprovado e botão Entrar no sistema.
- Status PENDENTE, ATIVO e BLOQUEADO.
- Bloqueio, reativação e remoção de acesso pelo Proprietário.
- Notificação e contador para novos usuários pendentes.
- Aprovação e bloqueio registrados na auditoria.
- Firestore Rules impedem autoelevação de perfil e autoaprovação.

## v2.0.1 — Dados e Desempenho
- Tela normal de Entregas/Devoluções carrega somente os últimos 6 meses.
- Registros antigos são preservados no Firestore e carregados sob demanda em "Consultar histórico anterior".
- Paginação de 50 registros por página.
- Relatórios carregam histórico antigo somente quando necessário.
- Consultas iniciais de movimentações usam filtro por data, reduzindo leitura e tempo de carregamento.
- Aprovação de usuário agora usa listener em tempo real (onSnapshot), sem espera de polling.
- Proprietário recebe solicitações de novos usuários em tempo real.
- Modais/cadastros corrigidos para nunca ficarem fora da tela no desktop; cabeçalho e botões permanecem acessíveis.

## v2.0.2 — Mobile / PWA
- Corrigido cadastro/login fora do enquadramento em telas menores ou com pouca altura.
- SSMA e Visualizador agora ficam realmente vinculados à usina definida pelo Proprietário.
- Dashboard, filtros, colaboradores, EPIs, movimentações e relatórios são carregados somente para a usina autorizada em perfis segmentados.
- Filtro de usina fica bloqueado para SSMA/Visualizador, evitando aparecer "Todas as usinas".
- Aprovação impede SSMA/Visualizador com opção TODAS.
- Carregamento Firestore segmentado por usina, alinhado às Rules e mais eficiente.
- PWA com botão Instalar app quando o navegador oferece instalação.
- Manifest aprimorado com atalhos para Painel, Movimentações e EPIs.
- Mobile com menu lateral em gaveta, navegação inferior com safe-area, modais tipo bottom-sheet e campos maiores para toque.
- Melhorias para execução em modo standalone.

## v2.0.3 — Correções Mobile + Leitor QR
- Removida completamente a barra inferior de acesso rápido, inclusive na tela de login.
- Removidos os contadores amarelos do menu lateral.
- Corrigido botão Sair duplicado ("SairSair").
- Cadastro/login com rolagem vertical real e enquadramento para telas pequenas.
- Cards de Colaboradores, EPIs e Usuários passam a ocupar 100% da largura no mobile.
- Botões dos cards reorganizados em grids estáveis e sem sobreposição.
- Cabeçalhos, filtros e cards de EPI corrigidos para celulares estreitos.
- Nova aba Leitor QR para abrir a ficha do colaborador com a câmera.
- Leitor QR utiliza os códigos já gerados pelo sistema e respeita a usina autorizada do usuário.
- Busca manual por colaborador disponível como alternativa ao leitor de câmera.

## v2.0.4 — Sessão, Instalação PWA e Atualização
- Corrigido logout no mobile: fecha o menu, esconde o aplicativo e mostra somente a tela de login.
- O app não permanece visível por trás da tela de autenticação.
- Instalação PWA reforçada com botão sempre acessível quando não estiver em modo instalado.
- Se o Chrome não fornecer o prompt automático, o sistema mostra instruções de instalação pelo menu do navegador.
- Manifest ganhou ID estável, launch_handler e configurações de instalação mais compatíveis.
- Service Worker revisado com cache do shell do aplicativo e ciclo de atualização explícito.
- Verificação de versão ocorre ao abrir, voltar ao app, reconectar à internet e a cada 1 minuto.
- Nova atualização gera banner visível “Atualização disponível / Atualizar agora”, inclusive no PWA instalado.
- Atualização força o novo Service Worker e limpa apenas caches antigos do Gestão de EPIs.

## v2.0.5 — Correção + Compartilhamento
- Corrigido erro JavaScript `Unexpected token '}'` que impedia o login.
- Logout reorganizado para fechar o menu e encerrar corretamente listeners da sessão.
- Adicionado cartão social 1200x630 para prévia de links em WhatsApp, Teams, Facebook e serviços compatíveis com Open Graph.
- Adicionadas metatags Open Graph e Twitter Card.
- Botão Compartilhar usa o compartilhamento nativo do celular; em desktop copia o link quando necessário.
- `share-card.png` incluído no pacote e no cache do PWA.

## v2.0.6 — Interface superior e compartilhamento
- Barra superior reorganizada para evitar compressão do título e controles.
- Removidos os botões grandes Compartilhar e Instalar da barra superior.
- Novo menu compacto “•••” concentra Compartilhar, Instalar e Verificar atualização.
- Busca se compacta automaticamente em larguras menores.
- Compartilhamento envia somente a URL canônica, sem query string, parâmetros ou texto extra.
- Eliminado o caractere “?” que aparecia ao compartilhar no WhatsApp.
- Cartão social redesenhado com visual mais limpo e profissional.

## v2.0.7 — Ajustes de interface
- Removido o texto “VISÃO” acima do seletor de usinas no painel.
- Seletor de usinas alinhado verticalmente com os demais controles da barra superior.
- Corrigido bug mobile onde Cards e Lista apareciam simultaneamente.
- Alternância Cards/Lista reforçada em Colaboradores, EPIs e Usuários.
- O modo Lista agora oculta completamente os cards, inclusive no CSS mobile.

## v2.0.8 — Estrutura mobile corrigida
- Barra superior mobile reconstruída para não comprimir o título.
- No celular ficam apenas Menu, título, Notificações, Mais ações e Busca na primeira linha.
- Seletor de usina foi movido para uma linha própria no Dashboard mobile.
- Seletor mobile sincronizado com o seletor desktop e respeita a usina vinculada ao perfil.
- KPIs passam para uma coluna real em telas pequenas.
- Corrigida possibilidade de overflow horizontal no painel mobile.
- Corrigido aviso `Manifest: Enctype should be set` adicionando enctype ao share_target.
- Service Worker agora trata falhas de rede sem gerar `Uncaught TypeError: Failed to fetch`.

## v2.0.9 — Correção de rolagem mobile
- Corrigida a rolagem vertical do sistema em celulares e PWA instalado.
- Removidas limitações de height/max-height/overflow que prendiam a página à altura da tela.
- O bloqueio de rolagem agora ocorre somente enquanto o menu lateral estiver aberto.
- Ao fechar o menu ou navegar para outra aba, qualquer bloqueio de scroll é removido.
- Tabelas continuam permitindo rolagem horizontal sem impedir a rolagem vertical da página.

## v2.1.0 — Busca, filtro global, QR em lote e carregamento
- Corrigida a busca de Colaboradores sem uso de handler inline incompatível com módulos.
- Busca por nome, matrícula e função.
- Colaboradores sempre organizados em ordem alfabética.
- Seletor superior de usina passa a funcionar como filtro global em Dashboard, Movimentações, Colaboradores, EPIs, Usuários e Relatórios.
- No mobile, o seletor de usina aparece abaixo do cabeçalho em todas as abas.
- Novo botão QR Codes na aba Colaboradores para imprimir todos os QRs do filtro atual ou salvar a folha como PDF.
- Tela profissional de carregamento durante restauração da sessão; a tela de login não pisca antes da entrada automática.
