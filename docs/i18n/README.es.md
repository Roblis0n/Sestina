<div align="center">
  <img src="../../apps/research-room/client/public/sestina-logo.png" width="120" height="120" alt="Logotipo de Sestina">
  <h1>Sestina</h1>
  <p><strong>Una sala de investigación local para mantener el trabajo con IA enfocado, verificable y bajo tu autoridad.</strong></p>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · **Español** · [Français](README.fr.md) · [Deutsch](README.de.md)
</div>

---

Sestina es una aplicación de investigación local e interactiva para trabajos
que duran más que una conversación. Research Room mantiene en un mismo espacio
la pregunta activa, la evidencia, las decisiones, los problemas abiertos, las
correcciones, la procedencia y la siguiente acción segura. Los modelos pueden
proponer; solo la persona usuaria puede aceptar, rechazar, resolver, dispensar
o cambiar la dirección de la investigación.

## Qué aporta

- Una línea de investigación persistente y un Research Brief versionado evitan
  que la pregunta cambie silenciosamente.
- Authority Gate separa propuestas y decisiones formales, exige una acción
  directa del usuario y genera recibos añadidos de forma inmutable.
- Antes de una llamada opcional a un Provider, Sestina muestra el Context
  Manifest exacto: contenido incluido y excluido, propósito, límites e
  identidades hash.
- Las evaluaciones pueden impugnarse mediante Correction Appeals y una segunda
  opinión configurada por separado.
- Una sala de deliberación limitada compara dos participantes mutuamente
  ciegos, sin votación, ganador ni síntesis automática con autoridad.
- La memoria gobernada por proyecto, las copias de seguridad, la restauración y
  las migraciones permiten reanudar el trabajo sin inventar contexto.

## Autoridad y privacidad

Research Deliberation Kernel es el núcleo de reglas y Research Room es la
interfaz principal. CLI, Skills, MCP y adaptadores de host son capas de acceso
estrechas; el MCP público es de solo lectura.

El usuario es la única autoridad de investigación. Una respuesta de Provider,
el acuerdo entre modelos, una firma, un hash o el éxito de una herramienta no
pueden modificar Briefs, Decisions, Issues, Reviews, Appeals ni Deliberations.
Cuando falta evidencia, el estado sigue siendo unknown o unproven.

Los datos permanecen por defecto en `.sestina`, dentro del proyecto elegido.
No hay cuenta obligatoria en la nube, sincronización en segundo plano,
telemetría, envío de fallos ni carga automática. Solo se envía contexto a un
Provider externo cuando el usuario configura la conexión, revisa el Manifest
exacto y confirma esa solicitud concreta.

## Ejecutar la versión preliminar 0.2.0

Necesitas Node.js 24.x y un navegador local.

1. Descarga `SHA256SUMS` y el único archivo compatible con tu sistema desde la
   [Release `v0.2.0`](https://github.com/Roblis0n/Sestina/releases/tag/v0.2.0).
2. Verifica el SHA-256 y extrae el archivo en una carpeta nueva y vacía.
3. Dentro del directorio extraído, ejecuta:

```text
node start.mjs --version --json
node start.mjs
```

Abre únicamente la dirección `http://127.0.0.1:...` que imprime el programa.
Se admiten Windows x64, macOS arm64 y Ubuntu x64. Consulta la
[guía de publicación](../release/README.md) para más detalles.

La versión 0.2.0 se distribuye como archivo: no incluye instalador, actualización
automática, firma, notarización, servicio en segundo plano, publicación npm ni
sincronización en la nube. Las pruebas verifican el software y sus artefactos;
no demuestran la calidad semántica de un Provider ni la validez de una
conclusión de investigación.

El proyecto usa [Apache License 2.0](../../LICENSE). Lee
[CONTRIBUTING.md](../../CONTRIBUTING.md) y utiliza únicamente datos sintéticos
en incidencias y contribuciones.
