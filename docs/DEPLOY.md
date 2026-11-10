# Deploy

Dos piezas, dos servicios:

| Pieza | Dónde | Por qué |
|---|---|---|
| Frontend (`frontend/`, Vite + React) | Vercel | Son archivos estáticos; el free tier alcanza de sobra (el `dist` pesa ~400 KB). |
| Backend (`backend/` + el modelo) | Un contenedor con CPU propia (Render, Fly, un VPS) | El solve dura minutos u horas y el estado vive en el proceso. |

## Por qué el backend no va en Vercel

No es un problema de configuración, es la forma de la aplicación:

1. **Los casos viven en disco.** `POST /api/cases` escribe los 14 CSVs en
   `storage/cases/{case_id}/` y los leen después `/solve`, `/calendar`,
   `/derive` y `/download` — requests distintos. En serverless cada invocación
   arranca con su propio filesystem efímero.
2. **Los jobs viven en memoria.** `solver_jobs._JOBS` es un dict en proceso y
   cada solve es un `threading.Thread`. Nada de eso sobrevive entre
   invocaciones, y la guía de Python de Vercel avisa que los threads sin
   trackear se cortan cuando la instancia se apaga.
3. **El solve dura más que cualquier función.** Las funciones del plan Hobby
   cortan a los 300 s y `ParamsForm` ofrece límites de hasta 240 minutos. Los
   puntos 1 y 2 se arreglan con storage externo y un registro durable; este no:
   un solve de 15 minutos no entra en una función de 5.

## Backend en Render

El repo trae `Dockerfile` y `render.yaml`. En el dashboard: **Blueprints → New
Blueprint Instance**, apuntá al repo y Render levanta el servicio del
blueprint.

Lo que deja configurado:

- **Plan `standard`** (1 CPU / 2 GB, ~US$25/mes). No es el piso por gusto: el
  `starter` (0.5 CPU / 512 MB, ~US$7/mes) **no alcanza** para los casos
  grandes — ver "Qué se verificó". En blueprints nuevos el campo puede pedir
  el id nuevo (`1c-2g`) en vez del nombre.
- **Disco de 1 GB en `/data`** con `CASES_STORAGE_DIR=/data/cases`, para que los
  casos subidos sobrevivan a un restart. Sin disco, el free tier borra todo al
  dormirse y un upload queda huérfano antes del solve.
- **`SOLVER_THREADS=1`**: dentro de un contenedor `os.cpu_count()` informa los
  cores del host, no la cuota, así que sin esto el solver pide 8 threads sobre
  media CPU.
- **`healthCheckPath: /api/health`**.
- **`--workers 1`** en el `CMD` del Dockerfile. No es negociable: con más de un
  worker, un `POST /solve` y el polling de ese job pueden caer en procesos
  distintos y el job "no existe".

Si vas a usar el solver `GUROBI_CMD`, cargá a mano en el dashboard
`GRB_WLSACCESSID`, `GRB_WLSSECRET` y `GRB_LICENSEID` (los mismos del `.env`
local). Sin esas variables ese solver falla y el error sale por
`job.error_message`; `HiGHS` y `PULP_CBC_CMD` andan sin licencia.

### En un VPS en vez de Render

El mismo `Dockerfile` sirve, y por el mismo precio un VPS suele dar más CPU y
RAM que Render, que es lo que le importa al MIP. A cambio, el TLS, el deploy y
los backups quedan a cargo tuyo. (Los precios de VPS cambiaron bastante en
2026: conviene mirarlos en el momento en vez de confiar en una cifra vieja.)

```sh
docker build -t proyecto-grado-api .
docker run -d --name api -p 8000:8000 \
  -v /srv/proyecto-grado/cases:/data/cases \
  -e CASES_STORAGE_DIR=/data/cases -e SOLVER_THREADS=2 \
  proyecto-grado-api
```

## Frontend en Vercel

Importá el repo y poné **Root Directory = `frontend`** (ahí están el
`package.json` y el `vercel.json`). El resto lo detecta solo: `npm run build`,
output en `dist/`.

`frontend/vercel.json` tiene los dos rewrites que hacen falta:

- `/api/:path*` → el backend. El cliente pega siempre a rutas relativas
  `/api/...` (ver `ARQUITECTURA_INTERFAZ.md` §5), así que este proxy evita
  tener que agregar CORS en FastAPI o meter una base URL en el bundle.
  **Cambiá el host** por el de tu servicio.
- `/(.*)` → `/index.html`, para que `/generacion` y `/modificacion` funcionen
  como deep links (son rutas de react-router, no archivos). Vercel aplica los
  rewrites después de buscar en el filesystem, así que los assets siguen
  resolviendo normal.

## Dependencias

`requirements.txt` es la lista editable a mano (las directas). El Dockerfile
instala `requirements.lock.txt`, que fija además las transitivas: sin eso un
build nuevo trae lo último de cada una — el primer build de esta imagen instaló
numpy 2.4.6 y no la 2.2.3 del entorno local. Para regenerarlo después de tocar
`requirements.txt`:

```sh
docker build --platform linux/amd64 -t api-tmp .
docker run --rm api-tmp pip freeze > requirements.lock.txt   # revisar el diff
```

Quedan afuera `matplotlib`, `seaborn` y `pyyaml`: sólo los usan los scripts de
investigación de la raíz, no la API (~60 MB menos).

## Checklist de verificación

1. `curl https://<backend>/api/health` → `{"status":"ok"}`.
2. Abrir `https://<frontend>/modificacion` directo (no desde la home): si
   devuelve 404, falta el rewrite de SPA.
3. Subir los 14 CSVs de `ejemplos_csv/` y confirmar que vuelve un `case_id`
   (prueba el disco y el límite de tamaño del upload).
4. Correr un solve chico de punta a punta y bajar el CSV.
5. Recién ahí, un caso real con un límite de tiempo acorde al plan contratado.

## Qué se verificó

La imagen se construyó para `linux/amd64` (la arquitectura de Render, no la del
Mac) y se probó corriendo, con un volumen montado en `/data` y
`SOLVER_THREADS=1`:

- `GET /api/health` → `{"status":"ok"}`.
- `POST /api/cases` con los 14 CSVs por multipart → `case_id`, y los archivos
  quedan en el volumen.
- `POST /solve` → polling → `optimal`, con **HiGHS y con PULP_CBC_CMD** (el
  `libgomp1` del Dockerfile es justamente para el binario de CBC, que en
  x86-64 viene dinámicamente enlazado; el de arm64 es estático).
- `GET /result` y `GET /download` devuelven la grilla y el CSV con su
  `Content-Disposition`.
- Un build desde cero (`--no-cache`) contra `requirements.lock.txt` reproduce
  todo lo anterior.

### Caso real grande: `caso_1s1p` (65 UCs, 10 días x 3 turnos, HiGHS)

Corrido contra la imagen con los límites de cada plan (`--cpus` / `--memory`),
límite de tiempo de 60 min:

| Plan | CPU | Resultado | Pico de memoria |
|---|---|---|---|
| `starter` (0.5 CPU / 512 MB) | clavado en 50% | **OOM, exit 137** a los ~42 min | 512 MB (techo) |
| `standard` (1 CPU / 2 GB) | clavado en 100% | `timeout` **con calendario factible**, 65 evaluaciones ubicadas, objetivo 73.16 | 1.27 GB |

En `starter` no hay degradación elegante: no devuelve `timeout`, se muere el
contenedor entero, se pierde el registro de jobs en memoria y el frontend queda
haciendo polling contra un servicio que se reinició. Por eso el blueprint fija
`standard`.

Lo que **no** se probó: los servicios en Render/Vercel, que hay que crear con
las cuentas propias, y un límite de tiempo mayor a 60 min.

## Pendientes conocidos

- **Los jobs se pierden en un restart.** `_JOBS` es en memoria. Verificado en
  el contenedor: después de `docker restart`, el caso subido sigue estando
  (`POST /solve` sobre él devuelve 202, gracias al disco) pero el `job_id`
  anterior devuelve **404**, así que el frontend queda haciendo polling de un
  job que ya no existe. Aceptable para un solo usuario; si molesta, hay que
  persistir el registro de jobs junto a los casos.
- **`caso_1s1p` no prueba optimalidad en 60 min con 1 CPU.** Devuelve un
  calendario factible y usable, pero `proven_optimal: false`. Para los casos
  grandes hay que usar los límites altos de `ParamsForm` (180-240 min).
- **El pico de 1.27 GB se midió a 60 min.** Un run de 240 min explora un árbol
  de branch-and-bound más grande y puede pedir más memoria, así que no está
  verificado que entre en los 2 GB de `standard`. Conviene medirlo antes de
  prometer corridas largas.
