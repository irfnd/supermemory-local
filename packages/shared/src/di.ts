import 'reflect-metadata';
import { container, instanceCachingFactory, type DependencyContainer } from 'tsyringe';

export type { DependencyContainer };

export type Token<T> = symbol & { readonly __type?: T };

export const token = <T>(description: string) => Symbol(description) as Token<T>;

export const createContainer = (): DependencyContainer => container.createChildContainer();

export const provide = <T>(target: DependencyContainer, key: Token<T>, value: T) => target.register(key, { useValue: value });

export const singleton = <T>(target: DependencyContainer, key: new (...args: any[]) => T, build: (c: DependencyContainer) => T) =>
	target.register(key, { useFactory: instanceCachingFactory(build) });

export const get = <T>(source: DependencyContainer, key: Token<T>): T => source.resolve<T>(key);

export const getAll = <T>(source: DependencyContainer, key: Token<T>): T[] => source.resolveAll<T>(key);
