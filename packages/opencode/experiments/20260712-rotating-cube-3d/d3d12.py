import os
import sys

# Define the absolute path to your x64 DXC binaries folder
# Replace this string with your actual local system directory path
DXC_BIN_DIR = r"D:\zPython\opencode\packages\opencode\experiments\20260712-rotating-cube-3d\bin\x64"

if os.path.isdir(DXC_BIN_DIR):
    # Prepend to os.environ['PATH'] so Dawn finds these DLLs first
    os.environ["PATH"] = DXC_BIN_DIR + os.pathsep + os.environ["PATH"]
    # Required for Python 3.8+ on Windows to safely load DLL assets
    os.add_dll_directory(DXC_BIN_DIR)
else:
    print(f"Warning: DXC binary path target not found: {DXC_BIN_DIR}")
