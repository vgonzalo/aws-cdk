import * as path from 'path';
import { AssemblyManifest, Manifest, ArtifactType, AwsCloudFormationStackProperties, ArtifactManifest, MetadataEntry } from '@aws-cdk/cloud-assembly-schema';
import * as fs from 'fs-extra';

/**
 * Trace information for stack
 * map of resource logicalId to trace message
 */
export type StackTrace = Map<string, string>;

/**
 * Trace information for a assembly
 *
 * map of stackId to StackTrace
 */
export type ManifestTrace = Map<string, StackTrace>;

/**
 * Reads a Cloud Assembly manifest
 */
export class AssemblyManifestReader {
  public static readonly DEFAULT_FILENAME = 'manifest.json';

  /**
   * Reads a Cloud Assembly manifest from a file
   */
  public static fromFile(fileName: string): AssemblyManifestReader {
    try {
      const obj = Manifest.loadAssemblyManifest(fileName);
      return new AssemblyManifestReader(path.dirname(fileName), obj, fileName);

    } catch (e) {
      throw new Error(`Cannot read integ manifest '${fileName}': ${e.message}`);
    }
  }

  /**
   * Reads a Cloud Assembly manifest from a file or a directory
   * If the given filePath is a directory then it will look for
   * a file within the directory with the DEFAULT_FILENAME
   */
  public static fromPath(filePath: string): AssemblyManifestReader {
    let st;
    try {
      st = fs.statSync(filePath);
    } catch (e) {
      throw new Error(`Cannot read integ manifest at '${filePath}': ${e.message}`);
    }
    if (st.isDirectory()) {
      return AssemblyManifestReader.fromFile(path.join(filePath, AssemblyManifestReader.DEFAULT_FILENAME));
    }
    return AssemblyManifestReader.fromFile(filePath);
  }

  /**
   * The directory where the manifest was found
   */
  public readonly directory: string;

  constructor(directory: string, private readonly manifest: AssemblyManifest, private readonly manifestFileName: string) {
    this.directory = directory;
  }

  /**
   * Get the stacks from the manifest
   * returns a map of artifactId to CloudFormation template
   */
  public get stacks(): Record<string, any> {
    const stacks: Record<string, any> = {};
    for (const [artifactId, artifact] of Object.entries(this.manifest.artifacts ?? {})) {
      if (artifact.type !== ArtifactType.AWS_CLOUDFORMATION_STACK) { continue; }
      const props = artifact.properties as AwsCloudFormationStackProperties;

      const template = fs.readJSONSync(path.resolve(this.directory, props.templateFile));
      stacks[artifactId] = template;
    }
    return stacks;
  }

  /**
   * Write trace data to the assembly manifest metadata
   */
  public recordTrace(trace: ManifestTrace): void {
    const newManifest = {
      ...this.manifest,
      artifacts: this.renderArtifacts(trace),
    };
    Manifest.saveAssemblyManifest(newManifest, this.manifestFileName);
  }

  /**
   * Clean the manifest of any unneccesary data. Currently that includes
   * the metadata trace information since this includes trace information like
   * file system locations and file lines that will change depending on what machine the test is run on
   */
  public cleanManifest(): void {
    const newManifest = {
      ...this.manifest,
      artifacts: this.renderArtifacts(),
    };
    Manifest.saveAssemblyManifest(newManifest, this.manifestFileName);
  }

  private renderArtifactMetadata(artifact: ArtifactManifest, trace?: StackTrace): { [id: string]: MetadataEntry[] } | undefined {
    const newMetadata: { [id: string]: MetadataEntry[] } = {};
    if (!artifact.metadata) return artifact.metadata;
    for (const [metadataId, metadataEntry] of Object.entries(artifact.metadata ?? {})) {
      newMetadata[metadataId] = metadataEntry.map((meta: MetadataEntry) => {
        if (meta.type === 'aws:cdk:logicalId' && trace && meta.data) {
          const traceData = trace.get(meta.data.toString());
          if (traceData) {
            trace.delete(meta.data.toString());
            return {
              type: meta.type,
              data: meta.data,
              trace: [traceData],
            };
          }
        }
        // return metadata without the trace data
        return {
          type: meta.type,
          data: meta.data,
        };
      });
    }
    if (trace && trace.size > 0) {
      for (const [id, data] of trace.entries()) {
        newMetadata[id] = [{
          type: 'aws:cdk:logicalId',
          data: id,
          trace: [data],
        }];
      }
    }
    return newMetadata;
  }

  private renderArtifacts(trace?: ManifestTrace): { [id: string]: ArtifactManifest } | undefined {
    const newArtifacts: { [id: string]: ArtifactManifest } = {};
    for (const [artifactId, artifact] of Object.entries(this.manifest.artifacts ?? {})) {
      let stackTrace: StackTrace | undefined = undefined;
      if (artifact.type === ArtifactType.AWS_CLOUDFORMATION_STACK && trace) {
        stackTrace = trace.get(artifactId);
      }
      newArtifacts[artifactId] = {
        ...artifact,
        metadata: this.renderArtifactMetadata(artifact, stackTrace),
      };
    }
    return newArtifacts;
  }
}
