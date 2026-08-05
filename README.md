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
