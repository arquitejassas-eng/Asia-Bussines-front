from fastapi import APIRouter

from app.api.routes import (
    admin_inventario, apartados, auth, bodegas, envios, ia, inventario, material_en_camino, prestamos, produccion,
    recepcion, reportes_inventario, rollos, siigo, usuarios,
)

router_api = APIRouter()
router_api.include_router(auth.router)
router_api.include_router(usuarios.router)
router_api.include_router(inventario.router)
router_api.include_router(bodegas.router)
router_api.include_router(rollos.router)
router_api.include_router(produccion.router)
router_api.include_router(apartados.router)
router_api.include_router(recepcion.router)
router_api.include_router(ia.router)
router_api.include_router(envios.router)
router_api.include_router(admin_inventario.router)
router_api.include_router(material_en_camino.router)
router_api.include_router(prestamos.router)
router_api.include_router(siigo.router)
router_api.include_router(reportes_inventario.router)
