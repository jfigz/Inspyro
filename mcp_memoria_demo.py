import asyncio
import json
from mcp.client.session import ClientSession
from mcp.client.sse import sse_client

async def main():
    mcp_url = "http://localhost:8100/mcp/sse"
    print(f"Connecting to Inspyro MCP at {mcp_url}...")
    try:
        async with sse_client(mcp_url) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                print("Connected! Initialized session.")
                
                # 1. Create Notebook
                print("Creating Memoria_Calculo.ipynb...")
                res_create = await session.call_tool("notebook_create", arguments={"path": "c:\\CalcPyro\\P2", "name": "Memoria_Calculo.ipynb"})
                if res_create.isError:
                    print(f"Error creating: {res_create}")
                    return
                print(res_create.content[0].text)
                data_create = json.loads(res_create.content[0].text)
                kernel_id = data_create["kernel_id"]
                nb_path = data_create["path"]
                
                # 2. Add cells
                source_1 = """# Resetear documento
doc_reset(hard=True)

# Bloque 1: Portada
with build_doc(block_id="portada", order=10) as builder:
    builder.heading("Memoria de Cálculo de Viga", level=1)
    builder.metadata(title="Memoria de Cálculo de Viga", subject="Análisis Estructural")
    builder.text("Proyecto: Estructura de Soporte", bold=True)
    builder.text("Fecha: 09/03/2026")
    builder.page_break()
"""
                print("Adding cell 1...")
                res_add1 = await session.call_tool("add_cell", arguments={"notebook_path": nb_path, "source": source_1, "cell_type": "code"})
                print(res_add1.content[0].text)
                
                source_2 = """# Parámetros de la viga
L = 5.0  # metros
q = 12.0 # kN/m

Ra = (q * L) / 2
Rb = Ra
M_max = (q * L**2) / 8
delta_max = (5 * q * (L**4)) / (384 * 200e6 * 5e-5) # Ejemplo de flecha

with build_doc(block_id="calculo", order=20) as builder:
    builder.heading("1. Parámetros y Cálculos", level=2)
    builder.text("Se tienen los siguientes parámetros:")
    builder.list([
        f"Luz (L): {L} m",
        f"Carga (q): {q} kN/m"
    ])
    
    builder.heading("1.1 Análisis Estructural", level=3)
    builder.math(f"V_{{max}} = R_a = R_b = \\frac{{qL}}{{2}} = {Ra:.2f} \\, \\text{{kN}}")
    builder.math(f"M_{{max}} = \\frac{{qL^2}}{{8}} = {M_max:.2f} \\, \\text{{kN\\cdot m}}")
    
    builder.heading("2. Resultados", level=2)
    builder.table([
        ["Elemento", "Valor", "Unidad"],
        ["Reacción en apoyos", f"{Ra:.2f}", "kN"],
        ["Momento Flector Máx", f"{M_max:.2f}", "kN·m"]
    ], headers=True)
"""
                print("Adding cell 2...")
                res_add2 = await session.call_tool("add_cell", arguments={"notebook_path": nb_path, "source": source_2, "cell_type": "code"})
                print(res_add2.content[0].text)
                
                source_3 = """# Export
with build_doc(block_id="export_msg", order=30) as builder:
    builder.text("Nota: Cálculo automatizado generado por Inspyro MCP.", italic=True)

ruta = doc_export(format="path", path="C:\\\\CalcPyro\\\\P2\\\\Memoria_Calculo.docx")
print(f"Documento guardado en {ruta}")
"""
                print("Adding cell 3...")
                res_add3 = await session.call_tool("add_cell", arguments={"notebook_path": nb_path, "source": source_3, "cell_type": "code"})
                print(res_add3.content[0].text)
                
                # 3. Save notebook before executing
                print("Saving Notebook...")
                await session.call_tool("notebook_save", arguments={"kernel_id": kernel_id, "path": nb_path})
                
                # 4. Execute all cells
                print("Executing Notebook...")
                res_exec = await session.call_tool("execute_all_cells", arguments={"kernel_id": kernel_id, "notebook_path": nb_path})
                if res_exec.isError:
                    print(f"Error executing: {res_exec}")
                    return
                print("Execution result:")
                print(res_exec.content[0].text)

    except Exception as e:
        print(f"Exception using MCP: {e}")

if __name__ == "__main__":
    asyncio.run(main())
