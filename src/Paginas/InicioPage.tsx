import { useControladorInicio } from "../Componentes/Inicio";
import EscenaTecho from "../Componentes/EscenaTecho";
import "../Style/Inicio.css";

type Sesion = { correo: string; bodegaId: number; bodegaNombre: string; rol: string };

function InicioPage({ onLogin, aviso = "" }: { onLogin: (sesion: Sesion) => void; aviso?: string }) {
  const {
    correo,
    setCorreo,
    contrasena,
    setContrasena,
    error,
    cargando,
    iniciarSesion,
  } = useControladorInicio(onLogin);

  return (
    <div className="inicio-page">
      <EscenaTecho />
      <div className="inicio-panel">
        <img src="/logo-arquitejas.jpg" alt="Arquitejas" className="inicio-logo" />
        <h1 className="inicio-titulo">Bienvenido  Arquitejas</h1>
        <p className="inicio-subtitulo">Ingresa tus datos para continuar</p>
        {aviso && <p className="inicio-error" role="status">{aviso}</p>}

        <form className="inicio-form" onSubmit={iniciarSesion} noValidate>
          <label className="inicio-label" htmlFor="correo">
            Correo electrónico
          </label>
          <input
            id="correo"
            type="email"
            className="inicio-input"
            placeholder="tu@correo.com"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
          />

          <label className="inicio-label" htmlFor="contrasena">
            Contraseña
          </label>
          <input
            id="contrasena"
            type="password"
            className="inicio-input"
            placeholder="••••••••"
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
          />

          {error && <p className="inicio-error">{error}</p>}

          <button type="submit" className="inicio-boton" disabled={cargando}>
            {cargando ? "Ingresando..." : "Iniciar sesión"}
          </button>
        </form>

       
      </div>
    </div>
  );
}

export default InicioPage;
