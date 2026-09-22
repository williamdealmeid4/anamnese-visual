# Ficha do procedimento

PWA mobile-first para ficha digital, termo de responsabilidade e revisão profissional em estúdios de tatuagem, piercing e estética.

## O que já está incluído

- Fluxo mobile do cliente.
- Cards de Saúde com perguntas obrigatórias.
- Mapa corporal 2D com vistas frontal e traseira.
- Upload/captura de foto da pele.
- Foto do documento.
- Assinatura no canvas.
- Aceite do termo.
- Revisão final e envio.
- Painel profissional em `/staff`.
- Alertas de contraindicação com estados de revisão, bloqueio e liberação.
- Persistência MongoDB quando `MONGO_URI` estiver configurado.
- Modo de demonstração em memória para desenvolvimento rápido.
- Manifest e Service Worker básicos de PWA.

## Executar localmente

Requer Python 3.12 ou superior.

```text
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload
```

Abra:

- Cliente: `http://127.0.0.1:8000/`
- Profissional: `http://127.0.0.1:8000/staff`
- Sessão de demonstração: `demo`

## MongoDB

Por padrão, a aplicação tenta conectar em `mongodb://127.0.0.1:27017`. Para outro servidor, configure `MONGO_URI` e `MONGO_DB`. Se o banco estiver indisponível, o sistema usa uma store em memória apenas para demonstração.

Para subir API e MongoDB juntos:

```text
docker compose up --build
```

## Próximas endurecimentos antes de produção

- Autenticação e RBAC para equipe.
- GridFS ou storage criptografado para mídias, sem guardar data URLs nos documentos.
- Criptografia de dados sensíveis.
- Política de retenção e exclusão aprovada juridicamente.
- Proteção CSRF, rate limit e logs estruturados.
- Revisão das regras pelo responsável técnico.
- Testes automatizados de regras e fluxos móveis.
