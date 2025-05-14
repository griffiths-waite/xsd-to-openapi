import { XMLParser } from "fast-xml-parser";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { basename, dirname, join } from "path";

const openApiTypeMap = {
    string: "string",
    decimal: "number",
    float: "number",
    double: "number",
    integer: "integer",
    boolean: "boolean",
    date: "string",
    dateTime: "string",
    time: "string",
} as const;

type OpenApiType = keyof typeof openApiTypeMap;

export interface OpenApiSpec {
    openapi: string;
    info: {
        title: string;
        description: string;
        version: string;
    };
    paths: Record<string, PathItem>;
}

interface PathItem {
    [key: string]: Operation | undefined;
}

interface SchemaProperty {
    type: string;
    items?: Schema;
    properties?: Record<string, SchemaProperty>;
    default?: string;
    fixed?: string;
    description?: string;
    required?: string[];
}

interface Schema {
    type: string;
    properties?: Record<string, SchemaProperty>;
    required?: string[];
    items?: Schema;
}

interface Operation {
    summary: string;
    description?: string;
    requestBody?: {
        required: boolean;
        content: Record<string, { schema: Schema }>;
    };
    responses: Record<
        string,
        {
            description?: string;
            content?: Record<string, { schema: Schema }>;
        }
    >;
}

interface XsdImport {
    "@_namespace": string;
    "@_schemaLocation": string;
}

interface XsdAnnotation {
    "xsd:appinfo"?: string;
    "xs:appinfo"?: string;
    "xsd:documentation"?: string;
    "xs:documentation"?: string;
}

interface XsdElement {
    "@_name": string;
    "@_type"?: string;
    "@_maxOccurs"?: string;
    "@_minOccurs"?: string;
    "@_default"?: string;
    "@_fixed"?: string;
    "xsd:annotation"?: XsdAnnotation[];
    "xs:annotation"?: XsdAnnotation[];
}

interface XsdSequence {
    "xsd:element"?: XsdElement[];
    "xsd:choice"?: XsdChoice[];
    "xs:element"?: XsdElement[];
    "xs:choice"?: XsdChoice[];
}

interface XsdChoice {
    "xsd:sequence"?: XsdSequence[];
    "xs:sequence"?: XsdSequence[];
}

interface XsdComplexType {
    "@_name": string;
    "xsd:sequence"?: XsdSequence[];
    "xsd:choice"?: XsdChoice[];
    "xs:sequence"?: XsdSequence[];
    "xs:choice"?: XsdChoice[];
}

interface XsdSchema {
    "@_targetNamespace"?: string;
    "@_id"?: string;
    "xsd:annotation"?: {
        "xsd:documentation"?: string;
    };
    "xsd:complexType": XsdComplexType[] | XsdComplexType;
    "xsd:simpleType"?: unknown[] | unknown;
    "xsd:element": XsdElement[] | XsdElement;
    "xsd:import"?: XsdImport[];
    "xs:annotation"?: {
        "xs:documentation"?: string;
    };
    "xs:complexType"?: XsdComplexType[] | XsdComplexType;
    "xs:simpleType"?: unknown[] | unknown;
    "xs:element"?: XsdElement[] | XsdElement;
    "xs:import"?: XsdImport[];
    [key: string]: any; // Required for detecting xml namespace prefixes
}

interface XsdObject {
    "xsd:schema"?: XsdSchema;
    "xs:schema"?: XsdSchema;
}

interface ErrorSchemaOptions {
    errorSchema: Schema;
    errorStatusCode: number;
    errorDescription?: string;
}

type HttpMethods = "get" | "post" | "put" | "delete" | "patch";

export interface XsdToOpenApiConfig {
    inputFilePath?: string;
    outputFilePath?: string;
    schemaName?: string;
    xsdContent?: string;
    specGenerationOptions?: SpecGeneratorOptions;
}

/**
 * Converts XSD schema to OpenAPI3.0 specification
 */
export async function xsdToOpenApi({
    inputFilePath,
    outputFilePath,
    schemaName,
    xsdContent,
    specGenerationOptions,
}: XsdToOpenApiConfig) {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        isArray: (name: string): boolean => {
            const arrayElements = [
                "xsd:element",
                "xsd:complexType",
                "xsd:simpleType",
                "xsd:attribute",
                "xsd:sequence",
                "xsd:choice",
                "xsd:import",
                "xs:element",
                "xs:complexType",
                "xs:simpleType",
                "xs:attribute",
                "xs:sequence",
                "xs:choice",
                "xs:import",
            ];
            return arrayElements.includes(name);
        },
    });

    try {
        const xsdObj: XsdObject = inputFilePath
            ? parser.parse(await readFile(inputFilePath, "utf8"))
            : parser.parse(xsdContent || "");

        const xsdSchema = xsdObj["xsd:schema"] || xsdObj["xs:schema"];

        if (!xsdSchema) throw new Error("Invalid XSD schema: No schema found");

        const specName = schemaName || basename(inputFilePath || "", ".xsd");

        const generatedSpec = await generateOpenApiSpec(
            xsdSchema,
            specName.toLowerCase(),
            inputFilePath || "",
            parser,
            specGenerationOptions || {},
        );

        const openapiJson = JSON.stringify(generatedSpec, undefined, 2);

        if (outputFilePath) {
            if (!existsSync(outputFilePath)) await mkdir(dirname(outputFilePath), { recursive: true });

            await writeFile(outputFilePath, openapiJson, { flag: "w+" });
        } else {
            throw new Error("Output file path is not specified");
        }
    } catch (error) {
        throw error;
    }
}

type ImportedSchemasMap = Record<string, XsdSchema>;

function resolveReferencedSchema(
    schema: XsdSchema,
    typeName: string,
    resolvedTypes = new Set<string>(),
    defaultType: OpenApiType,
    importedSchemas?: ImportedSchemasMap,
): Schema {
    if (resolvedTypes.has(typeName)) {
        return { type: "object", properties: {} }; // Break circular references
    }

    resolvedTypes.add(typeName);
    return generateSchema({ schema, typeName, resolvedTypes, importedSchemas, defaultType });
}

function getSequenceElements(complexType: XsdComplexType): XsdElement[] {
    const sequence = complexType["xsd:sequence"]?.[0] || complexType["xs:sequence"]?.[0];

    if (sequence) {
        const innerChoice = sequence["xsd:choice"]?.[0] || sequence["xs:choice"]?.[0];

        if (innerChoice) {
            const innerSequenceElements =
                innerChoice["xsd:sequence"]?.[0]["xsd:element"] || innerChoice["xs:sequence"]?.[0]["xs:element"];

            return innerSequenceElements || [];
        }

        return sequence["xsd:element"] || sequence["xs:element"] || [];
    }

    const choice = complexType["xsd:choice"]?.[0] || complexType["xs:choice"]?.[0];

    if (choice) {
        const innerSequenceElements =
            choice["xsd:sequence"]?.[0]["xsd:element"] || choice["xs:sequence"]?.[0]["xs:element"];

        return innerSequenceElements || [];
    }

    return [];
}

type GenerateSchemaParams = {
    schema: XsdSchema;
    typeName: string;
    resolvedTypes?: Set<string>;
    importedSchemas?: ImportedSchemasMap;
    defaultType: OpenApiType;
};

function generateSchema({
    schema,
    typeName,
    resolvedTypes = new Set<string>(),
    importedSchemas,
    defaultType,
}: GenerateSchemaParams) {
    const rawComplexTypes = schema["xsd:complexType"] || schema["xs:complexType"];

    const complexTypes: XsdComplexType[] = Array.isArray(rawComplexTypes)
        ? rawComplexTypes
        : [rawComplexTypes].filter((complexType) => complexType);

    const complexType = complexTypes.find((ct) => ct["@_name"] === typeName);

    if (!complexType) {
        return { type: defaultType };
    }

    const sequenceElements = getSequenceElements(complexType);

    const schemaType = sequenceElements.length > 0 ? "object" : defaultType; // Use defaultType if no elements are found

    const openApiSchema: Schema = { type: schemaType };

    sequenceElements.forEach((element: XsdElement) => {
        const subElementName = element["@_name"];
        const elementMaxOccurs = element["@_maxOccurs"];
        const { prefix, typeName: elementType } = resolveType(defaultType, element["@_type"]);

        let propertySchema: Schema | SchemaProperty;

        if (prefix && importedSchemas?.[prefix]) {
            const importedSchema = importedSchemas[prefix];
            propertySchema = resolveReferencedSchema(
                importedSchema,
                elementType,
                resolvedTypes,
                defaultType,
                importedSchemas,
            );
        } else if (!prefix && elementType) {
            const formattedElementType = elementType.replace("xsd:", "").replace("xs:", "");
            const mappedElementType = openApiTypeMap[formattedElementType as OpenApiType];

            mappedElementType
                ? (propertySchema = { type: mappedElementType })
                : (propertySchema = resolveReferencedSchema(
                      schema,
                      elementType,
                      resolvedTypes,
                      defaultType,
                      importedSchemas,
                  ));
        } else {
            propertySchema = { type: defaultType }; // Use defaultType if no type is found
        }

        const property: SchemaProperty =
            elementMaxOccurs === "unbounded"
                ? {
                      type: "array",
                      items: propertySchema,
                  }
                : propertySchema;

        const elementMinOccurs = element["@_minOccurs"] || null;
        const elementDefault = element["@_default"] || null;
        const elementFixed = element["@_fixed"] || null;
        const elementDescription =
            element["xsd:annotation"]?.[0]?.["xsd:documentation"] ||
            element["xs:annotation"]?.[0]?.["xs:documentation"];

        if (!elementMinOccurs || elementMinOccurs === "1") {
            if (!openApiSchema.required) {
                openApiSchema.required = [];
            }

            if (property.type !== "array") {
                openApiSchema.required.push(subElementName);
            }
        }

        if (elementDefault) property.default = elementDefault;
        if (elementFixed) property.fixed = elementFixed;
        if (elementDescription) property.description = elementDescription;

        if (!openApiSchema.properties) {
            openApiSchema.properties = {};
        }

        openApiSchema.properties[subElementName] = property;
    });

    return openApiSchema;
}

type NamespacePrefixMap = Map<string, { prefix: string }>;

function extractElementTypePrefixes(schema: XsdSchema) {
    const prefixes: NamespacePrefixMap = new Map();
    const xmlNamespaceTag = "@_xmlns:";

    Object.keys(schema).forEach((key) => {
        if (key.startsWith(xmlNamespaceTag)) {
            const prefix = key.slice(xmlNamespaceTag.length);

            // Avoid adding reserved XML namespace prefixes
            if (prefix !== "xsd" && prefix !== "xs") {
                prefixes.set(schema[key], { prefix });
                // Key is set to the namespace URI, value is the namsepace prefix
            }
        }
    });

    return prefixes;
}

async function getImportedSchemas(
    xsdImports: XsdImport[] | undefined,
    inputFilePath: string,
    parser: XMLParser,
    elementTypePrefixes: NamespacePrefixMap,
) {
    const importedSchemas: ImportedSchemasMap = {};

    if (!xsdImports || xsdImports.length === 0 || !inputFilePath) return;

    await Promise.all(
        xsdImports.map(async (xsdImport) => {
            const namespacePrefix = elementTypePrefixes.get(xsdImport["@_namespace"])?.prefix || "";

            if (namespacePrefix) {
                const importFileName = xsdImport["@_schemaLocation"].endsWith(".xsd")
                    ? xsdImport["@_schemaLocation"]
                    : `${xsdImport["@_schemaLocation"]}.xsd`;
                const importFilePath = join(dirname(inputFilePath), importFileName);

                const parsedXsd = parser.parse(await readFile(importFilePath, "utf8"));

                const importedSchema = parsedXsd["xsd:schema"] || parsedXsd["xs:schema"];

                if (importedSchema) {
                    importedSchemas[namespacePrefix] = importedSchema;
                } else {
                    throw new Error(`Invalid XSD schema: No schema found in ${importFilePath}`);
                }
            }
        }),
    );

    return importedSchemas;
}

function resolveType(defaultType: OpenApiType, rawType?: XsdElement["@_type"]) {
    if (!rawType) return { typeName: "string" };

    if (rawType.startsWith("tns:")) {
        return { typeName: rawType.slice(4) };
    }

    const typeParts = rawType.split(":");
    if (typeParts.length === 2 && typeParts[0] !== "xsd" && typeParts[0] !== "xs") {
        return { prefix: typeParts[0], typeName: typeParts[1] || defaultType };
    }

    return { typeName: rawType };
}

interface SpecGeneratorOptions {
    requestSuffix?: string;
    responseSuffix?: string;
    useSchemaNameInPath?: boolean;
    httpMethod?: HttpMethods;
    openApiVersion?: string;
    openApiSpecDescription?: string;
    contentType?: string;
    defaultType?: OpenApiType;
    error?: ErrorSchemaOptions;
}

async function generateOpenApiSpec(
    schema: XsdSchema,
    schemaName: string,
    inputFilePath: string,
    parser: XMLParser,
    options: SpecGeneratorOptions,
) {
    const {
        requestSuffix = "Req",
        responseSuffix = "Res",
        error,
        openApiVersion = "3.0.0",
        httpMethod = "post",
        contentType = "application/json",
        defaultType = "string",
        openApiSpecDescription,
        useSchemaNameInPath = false,
    } = options;

    const specDescription =
        openApiSpecDescription || `OpenAPI ${openApiVersion} specification generated from XSD schema ${schemaName}`;

    const openApiSpec: OpenApiSpec = {
        openapi: openApiVersion,
        info: {
            title: schemaName,
            description: specDescription,
            version: "1.0.0",
        },
        paths: {},
    };

    const importedSchemas = await getImportedSchemas(
        schema["xsd:import"] || schema["xs:import"],
        inputFilePath,
        parser,
        extractElementTypePrefixes(schema),
    );

    const rawElements = schema["xsd:element"] || schema["xs:element"];

    const validElements = Array.isArray(rawElements) ? rawElements : [rawElements].filter((element) => element);

    const groupedElements = validElements.reduce(
        (acc, element) => {
            const elementName = element["@_name"];
            let pathName = elementName;
            let isRequest = false;
            let isResponse = false;

            if (requestSuffix && elementName.endsWith(requestSuffix)) {
                pathName = elementName.substring(0, elementName.length - requestSuffix.length);
                isRequest = true;
            }

            if (responseSuffix && elementName.endsWith(responseSuffix)) {
                const potentialPathName = elementName.substring(0, elementName.length - responseSuffix.length);

                if (!isRequest || potentialPathName === pathName) {
                    pathName = potentialPathName;
                }

                isResponse = true;
            }

            if (isRequest || isResponse) {
                if (!acc[pathName]) acc[pathName] = {};
                if (isRequest) acc[pathName].request = element;
                if (isResponse) acc[pathName].response = element;
            }

            return acc;
        },
        {} as Record<string, { request?: XsdElement; response?: XsdElement }>,
    );

    Object.entries(groupedElements).forEach(([pathName, { request, response }]) => {
        if (!request && !response) return;

        const openApiPathName = useSchemaNameInPath ? `/${schemaName}/${pathName}` : `/${pathName}`;

        const operationDescription =
            request?.["xsd:annotation"]?.[0]?.["xsd:documentation"] ||
            request?.["xs:annotation"]?.[0]?.["xs:documentation"] ||
            "";

        const operation: Operation = {
            summary: `${httpMethod.toUpperCase()} ${openApiPathName}`,
            description: operationDescription,
            responses: {},
        };

        if (request) {
            operation.requestBody = {
                required: request["@_minOccurs"] !== "0",
                content: {
                    [contentType]: {
                        schema: generateSchema({
                            schema,
                            typeName: resolveType(defaultType, request["@_type"]).typeName,
                            defaultType,
                            importedSchemas,
                        }),
                    },
                },
            };
        }

        if (response) {
            const responseDescription = response["xsd:annotation"]?.[0]?.["xsd:documentation"] || "";

            operation.responses["200"] = {
                description: responseDescription,
                content: {
                    [contentType]: {
                        schema: generateSchema({
                            schema,
                            typeName: resolveType(defaultType, response["@_type"]).typeName,
                            defaultType,
                            importedSchemas,
                        }),
                    },
                },
            };
        }

        if (error) {
            operation.responses[error.errorStatusCode] = {
                description: error.errorDescription,
                content: {
                    [contentType]: {
                        schema: error.errorSchema,
                    },
                },
            };
        }

        openApiSpec.paths[openApiPathName] = { [httpMethod]: operation };
    });

    return openApiSpec;
}
