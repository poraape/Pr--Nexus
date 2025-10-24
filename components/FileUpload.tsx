import React, { useState, useCallback } from 'react';
import { UploadIcon, FileIcon } from './icons';
import { logger } from '../services/logger';

interface FileUploadProps {
  onStartAnalysis: (files: File[]) => void;
  disabled: boolean;
}

const FILE_SIZE_LIMIT_MB = 200;
const FILE_SIZE_LIMIT_BYTES = FILE_SIZE_LIMIT_MB * 1024 * 1024;

const FileUpload: React.FC<FileUploadProps> = ({ onStartAnalysis, disabled }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const handleFilesAdded = (newFiles: FileList) => {
      logger.log('FileUpload', 'INFO', `${newFiles.length} arquivo(s) recebido(s) para processamento.`);
      setError(null);
      const acceptedFiles: File[] = [];
      const rejectedFiles: {name: string, reason: string}[] = [];

      for (const file of Array.from(newFiles)) {
          if (file.size > FILE_SIZE_LIMIT_BYTES) {
              rejectedFiles.push({name: file.name, reason: `Tamanho excede ${FILE_SIZE_LIMIT_MB} MB`});
          } else if (files.some(f => f.name === file.name)) {
              rejectedFiles.push({name: file.name, reason: 'Arquivo já adicionado.'});
          }
          else {
              acceptedFiles.push(file);
          }
      }

      if(rejectedFiles.length > 0) {
        const errorMessage = `Arquivo(s) rejeitado(s): ${rejectedFiles.map(f => `${f.name} (${f.reason})`).join(', ')}.`;
        setError(errorMessage);
        logger.log('FileUpload', 'WARN', errorMessage, { rejectedFiles });
      }

      if (acceptedFiles.length > 0) {
        setFiles(prev => [...prev, ...acceptedFiles]);
      }
  };

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (!disabled && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesAdded(e.dataTransfer.files);
    }
  }, [disabled, files]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!disabled && e.target.files && e.target.files.length > 0) {
      handleFilesAdded(e.target.files);
      e.target.value = ''; // Reset input to allow re-uploading the same file
    }
  };

  const handleDemoFile = () => {
    if (disabled) return;
    const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
    <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
        <infNFe versao="4.00" Id="NFe35240712345678000195550010001234561000000015">
            <ide>
                <cUF>35</cUF>
                <cNF>00000001</cNF>
                <natOp>VENDA DE MERCADORIA</natOp>
                <mod>55</mod>
                <serie>1</serie>
                <nNF>123456</nNF>
                <dhEmi>2024-07-15T14:30:00-03:00</dhEmi>
                <tpNF>1</tpNF>
                <idDest>2</idDest>
                <cMunFG>3550308</cMunFG>
                <tpImp>1</tpImp>
                <tpEmis>1</tpEmis>
                <cDV>5</cDV>
                <tpAmb>2</tpAmb>
                <finNFe>1</finNFe>
                <indFinal>1</indFinal>
                <indPres>1</indPres>
                <procEmi>0</procEmi>
                <verProc>NexusI2A2-1.0</verProc>
            </ide>
            <emit>
                <CNPJ>12345678000195</CNPJ>
                <xNome>Nexus Tech Solutions LTDA</xNome>
                <xFant>Nexus Tech</xFant>
                <enderEmit>
                    <xLgr>Av. da Inovação</xLgr>
                    <nro>2048</nro>
                    <xBairro>Distrito Tecnológico</xBairro>
                    <cMun>3550308</cMun>
                    <xMun>São Paulo</xMun>
                    <UF>SP</UF>
                    <CEP>01010010</CEP>
                    <cPais>1058</cPais>
                    <xPais>BRASIL</xPais>
                </enderEmit>
                <IE>111222333444</IE>
            </emit>
            <dest>
                <CNPJ>98765432000110</CNPJ>
                <xNome>Quantum Innovations S.A.</xNome>
                <enderDest>
                    <xLgr>Rua da Computação Quântica</xLgr>
                    <nro>42</nro>
                    <xBairro>Centro</xBairro>
                    <cMun>3304557</cMun>
                    <xMun>Rio de Janeiro</xMun>
                    <UF>RJ</UF>
                    <CEP>20020020</CEP>
                    <cPais>1058</cPais>
                    <xPais>BRASIL</xPais>
                </enderDest>
                <indIEDest>1</indIEDest>
                <email>compras@quantuminnovations.com</email>
            </dest>
            <det nItem="1">
                <prod>
                    <cProd>P001</cProd>
                    <xProd>PROCESSADOR QUÂNTICO I2A2</xProd>
                    <NCM>84715010</NCM>
                    <CFOP>6101</CFOP>
                    <uCom>UN</uCom>
                    <qCom>2.0000</qCom>
                    <vUnCom>75000.00</vUnCom>
                    <vProd>150000.00</vProd>
                    <uTrib>UN</uTrib>
                    <qTrib>2.0000</qTrib>
                    <vUnTrib>75000.00</vUnTrib>
                    <indTot>1</indTot>
                </prod>
                <imposto>
                    <vTotTrib>54300.00</vTotTrib>
                    <ICMS>
                        <ICMS00>
                            <orig>0</orig>
                            <CST>00</CST>
                            <modBC>3</modBC>
                            <vBC>150000.00</vBC>
                            <pICMS>12.00</pICMS>
                            <vICMS>18000.00</vICMS>
                        </ICMS00>
                    </ICMS>
                    <PIS>
                        <PISAliq>
                            <CST>01</CST>
                            <vBC>150000.00</vBC>
                            <pPIS>1.65</pPIS>
                            <vPIS>2475.00</vPIS>
                        </PISAliq>
                    </PIS>
                    <COFINS>
                        <COFINSAliq>
                            <CST>01</CST>
                            <vBC>150000.00</vBC>
                            <pCOFINS>7.60</pCOFINS>
                            <vCOFINS>11400.00</vCOFINS>
                        </COFINSAliq>
                    </COFINS>
                </imposto>
            </det>
            <det nItem="2">
                <prod>
                    <cProd>P002</cProd>
                    <xProd>PLACA DE CRIPTOGRAFIA AVANÇADA</xProd>
                    <NCM>85423190</NCM>
                    <CFOP>6101</CFOP>
                    <uCom>UN</uCom>
                    <qCom>10.0000</qCom>
                    <vUnCom>12500.00</vUnCom>
                    <vProd>125000.00</vProd>
                    <uTrib>UN</uTrib>
                    <qTrib>10.0000</qTrib>
                    <vUnTrib>12500.00</vUnTrib>
                    <indTot>1</indTot>
                </prod>
                <imposto>
                    <vTotTrib>45250.00</vTotTrib>
                    <ICMS>
                        <ICMS00>
                            <orig>0</orig>
                            <CST>00</CST>
                            <modBC>3</modBC>
                            <vBC>125000.00</vBC>
                            <pICMS>12.00</pICMS>
                            <vICMS>15000.00</vICMS>
                        </ICMS00>
                    </ICMS>
                    <PIS>
                        <PISAliq>
                            <CST>01</CST>
                            <vBC>125000.00</vBC>
                            <pPIS>1.65</pPIS>
                            <vPIS>2062.50</vPIS>
                        </PISAliq>
                    </PIS>
                    <COFINS>
                        <COFINSAliq>
                            <CST>01</CST>
                            <vBC>125000.00</vBC>
                            <pCOFINS>7.60</pCOFINS>
                            <vCOFINS>9500.00</vCOFINS>
                        </COFINSAliq>
                    </COFINS>
                </imposto>
            </det>
            <det nItem="3">
                <prod>
                    <cProd>S001</cProd>
                    <xProd>CONSULTORIA EM ANÁLISE FISCAL</xProd>
                    <NCM>00000000</NCM>
                    <CFOP>5933</CFOP>
                    <uCom>HR</uCom>
                    <qCom>50.0000</qCom>
                    <vUnCom>800.00</vUnCom>
                    <vProd>40000.00</vProd>
                    <uTrib>HR</uTrib>
                    <qTrib>50.0000</qTrib>
                    <vUnTrib>800.00</vUnTrib>
                    <indTot>1</indTot>
                </prod>
                <imposto>
                    <vTotTrib>1850.00</vTotTrib>
                     <ISSQN>
                        <vBC>40000.00</vBC>
                        <vAliq>5.00</vAliq>
                        <vISSQN>2000.00</vISSQN>
                        <cMunFG>3550308</cMunFG>
                        <cListServ>01.06</cListServ>
                        <indIss>1</indIss>
                        <indIncentivo>2</indIncentivo>
                    </ISSQN>
                    <PIS>
                        <PISAliq>
                            <CST>01</CST>
                            <vBC>40000.00</vBC>
                            <pPIS>0.65</pPIS>
                            <vPIS>260.00</vPIS>
                        </PISAliq>
                    </PIS>
                    <COFINS>
                        <COFINSAliq>
                            <CST>01</CST>
                            <vBC>40000.00</vBC>
                            <pCOFINS>3.00</pCOFINS>
                            <vCOFINS>1200.00</vCOFINS>
                        </COFINSAliq>
                    </COFINS>
                </imposto>
            </det>
            <det nItem="4">
                <prod>
                    <cProd>P003-ERR</cProd>
                    <xProd>CABO DE DADOS (ERRO VALOR)</xProd>
                    <NCM>85444200</NCM>
                    <CFOP>5102</CFOP>
                    <uCom>M</uCom>
                    <qCom>100.0000</qCom>
                    <vUnCom>15.50</vUnCom>
                    <vProd>1550.01</vProd>
                    <uTrib>M</uTrib>
                    <qTrib>100.0000</qTrib>
                    <vUnTrib>15.50</vUnTrib>
                    <indTot>1</indTot>
                </prod>
                <imposto>
                    <vTotTrib>421.15</vTotTrib>
                    <ICMS>
                        <ICMS00>
                            <orig>0</orig>
                            <CST>00</CST>
                            <modBC>3</modBC>
                            <vBC>1550.01</vBC>
                            <pICMS>18.00</pICMS>
                            <vICMS>279.00</vICMS>
                        </ICMS00>
                    </ICMS>
                    <PIS><PISAliq><CST>01</CST><vBC>1550.01</vBC><pPIS>1.65</pPIS><vPIS>25.58</vPIS></PISAliq></PIS>
                    <COFINS><COFINSAliq><CST>01</CST><vBC>1550.01</vBC><pCOFINS>7.60</pCOFINS><vCOFINS>117.80</vCOFINS></COFINSAliq></COFINS>
                </imposto>
            </det>
            <det nItem="5">
                <prod>
                    <cProd>P004-BONIF</cProd>
                    <xProd>MOUSEPAD BRINDE</xProd>
                    <NCM>39269090</NCM>
                    <CFOP>5910</CFOP>
                    <uCom>UN</uCom>
                    <qCom>5.0000</qCom>
                    <vUnCom>0.00</vUnCom>
                    <vProd>0.00</vProd>
                    <uTrib>UN</uTrib>
                    <qTrib>5.0000</qTrib>
                    <vUnTrib>0.00</vUnTrib>
                    <indTot>1</indTot>
                </prod>
                <imposto>
                    <ICMS><ICMS40><orig>0</orig><CST>41</CST></ICMS40></ICMS>
                    <PIS><PISNT><CST>08</CST></PISNT></PIS>
                    <COFINS><COFINSNT><CST>08</CST></COFINSNT></COFINS>
                </imposto>
            </det>
            <total>
                <ICMSTot>
                    <vBC>276550.01</vBC>
                    <vICMS>33279.00</vICMS>
                    <vICMSDeson>0.00</vICMSDeson>
                    <vFCP>0.00</vFCP>
                    <vBCST>0.00</vBCST>
                    <vST>0.00</vST>
                    <vFCPST>0.00</vFCPST>
                    <vFCPSTRet>0.00</vFCPSTRet>
                    <vProd>316550.01</vProd>
                    <vFrete>0.00</vFrete>
                    <vSeg>0.00</vSeg>
                    <vDesc>0.00</vDesc>
                    <vII>0.00</vII>
                    <vIPI>0.00</vIPI>
                    <vIPIDevol>0.00</vIPIDevol>
                    <vPIS>4823.08</vPIS>
                    <vCOFINS>22217.80</vCOFINS>
                    <vOutro>0.00</vOutro>
                    <vNF>352046.81</vNF>
                </ICMSTot>
                <ISSQNtot>
                    <vServ>40000.00</vServ>
                    <vBC>40000.00</vBC>
                    <vISS>2000.00</vISS>
                    <vPIS>260.00</vPIS>
                    <vCOFINS>1200.00</vCOFINS>
                    <dCompet>2024-07-15</dCompet>
                </ISSQNtot>
            </total>
        </infNFe>
    </NFe>
</nfeProc>`;
    const demoFile = new File([mockXml], "NFe_Demonstracao_Completa.xml", { type: "text/xml" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(demoFile);
    handleFilesAdded(dataTransfer.files);
  };
  
  const handleStart = () => {
    if (files.length > 0 && !disabled) {
        onStartAnalysis(files);
        setFiles([]);
    }
  };

  const fileTypes = ".xml,.csv,.xlsx,.pdf,.png,.jpeg,.jpg,.zip,application/zip,application/x-zip-compressed";

  const containerClasses = `
    border-2 border-dashed rounded-xl p-6 text-center transition-all duration-300
    ${disabled ? 'bg-gray-800/50 border-gray-700 cursor-not-allowed' :
      isDragging ? 'bg-blue-900/30 border-blue-400 scale-105' :
      'bg-gray-800/50 border-gray-600 hover:border-blue-500 hover:bg-gray-800'
    }
  `;

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
      <h2 className="text-xl font-bold mb-4 text-gray-200">1. Upload de Arquivos</h2>
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={containerClasses}
      >
        <input
          type="file"
          id="file-upload"
          className="hidden"
          multiple
          accept={fileTypes}
          onChange={handleFileChange}
          disabled={disabled}
        />
        <label htmlFor="file-upload" className={disabled ? 'cursor-not-allowed' : 'cursor-pointer'}>
          <div className="flex flex-col items-center justify-center">
            <UploadIcon className={`w-12 h-12 mb-4 ${disabled ? 'text-gray-600' : 'text-gray-400'}`} />
            <p className={`font-semibold ${disabled ? 'text-gray-500' : 'text-blue-400'}`}>
              Clique ou arraste novos arquivos
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Suportados: XML, CSV, XLSX, PDF, Imagens (PNG, JPG), ZIP (limite de {FILE_SIZE_LIMIT_MB}MB)
            </p>
          </div>
        </label>
      </div>
       <div className="text-center mt-4">
          <button
              onClick={handleDemoFile}
              disabled={disabled}
              className="text-xs text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors underline"
          >
              Não tem um arquivo? Use um exemplo de demonstração.
          </button>
      </div>
       {error && <p className="text-xs text-red-400 mt-2 text-center">{error}</p>}
       {files.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-400 mb-2">Fila de processamento:</h3>
          <ul className="max-h-32 overflow-y-auto space-y-1 pr-2">
            {files.map((file, index) => (
              <li key={index} className="flex items-center justify-between text-xs bg-gray-700/50 p-2 rounded">
                <div className="flex items-center truncate">
                    <FileIcon className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
                    <span className="truncate text-gray-300">{file.name}</span>
                </div>
                <span className="text-gray-400 flex-shrink-0 ml-2">{formatBytes(file.size)}</span>
              </li>
            ))}
          </ul>
           <button
            onClick={handleStart}
            disabled={disabled || files.length === 0}
            className="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-lg transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
           >
            Analisar {files.length} Arquivo(s)
           </button>
        </div>
      )}
    </div>
  );
};

export default FileUpload;